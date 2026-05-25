// ============================================================
// Secrets vault — encrypted at-rest storage for integration credentials.
//
// One row per (userId, integration, key). All sensitive values encrypted
// with AES-256-GCM via crypto.js. The plaintext NEVER leaves the server
// after being saved — GET endpoints return only metadata (presence,
// last-4 chars, updatedAt) so the browser can show a redacted version.
//
// The proxy endpoints (proxy-anthropic.js etc.) call back into here
// internally via readSecret() / readIntegration() to decrypt before
// forwarding requests to the upstream API.
// ============================================================
import express from 'express';
import { secrets, audit } from '../db.js';
import { encrypt, decrypt, lastChars } from '../crypto.js';
import { requireAuth } from './auth.js';

const router = express.Router();
router.use(requireAuth);

// Whitelist of accepted integrations + their valid key names.
// We refuse to store anything outside this list so the vault can't be
// abused as a generic blob store.
export const INTEGRATIONS = {
  anthropic: ['apiKey', 'model'],
  // DocuSign was removed from the vault when the integration switched
  // to a JWT service account configured via server env vars
  // (DOCUSIGN_INTEGRATION_KEY etc.). Any pre-migration rows in the
  // secrets table remain ignored — the integration code no longer
  // reads them.
  // Property Inspect — OAuth (authorization_code) only. PAT mode removed.
  // webhookToken is a per-user random string embedded in the public webhook
  // URL — receipt of a POST with a matching token identifies whose data
  // it is and authenticates the request (PI never authenticates with us
  // via OAuth — the URL itself is the credential).
  propertyInspect: ['clientId', 'clientSecret', 'redirectUri', 'baseUrl',
                    'tokenUrl', 'authorizeUrl', 'webhookToken',
                    'accessToken', 'refreshToken', 'tokenExpiry'],
  // Jibble — Client Credentials only. PAT mode removed.
  jibble: ['clientId', 'clientSecret', 'organizationId',
           'accessToken', 'tokenExpiry'],
};

// Keys whose value is non-sensitive (URLs, identifiers, env names). We
// store them unencrypted so they can be returned in GET responses
// without round-tripping through the cipher.
export const PLAINTEXT_KEYS = new Set([
  'model', 'environment', 'redirectUri', 'baseUri', 'baseUrl',
  'tokenUrl', 'authorizeUrl', 'authMethod', 'apiBaseUrl', 'userId',
  'userEmail', 'accountId', 'organizationId', 'tokenExpiry',
  'webhookToken',
]);

const isValidKey = (integration, key) =>
  INTEGRATIONS[integration] && INTEGRATIONS[integration].includes(key);

// Decrypt + enrich a stored row for client display. NEVER returns the
// plaintext of a sensitive secret — only last-4 + length.
const enrichForClient = (row) => {
  const base = {
    integration: row.integration,
    key: row.key,
    updatedAt: row.updatedAt,
  };
  if (row.iv === 'PLAINTEXT') {
    return { ...base, value: row.ciphertext, isPlaintext: true };
  }
  try {
    const v = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
    return {
      ...base,
      isPlaintext: false,
      hasValue: !!v,
      last4: lastChars(v, 4),
      length: v.length,
    };
  } catch {
    return { ...base, isPlaintext: false, hasValue: false, last4: '', length: 0, decryptError: true };
  }
};

// --- GET /api/secrets — every integration row the current user has ---
router.get('/', (req, res) => {
  const rows = secrets.list(req.session.userId).map(enrichForClient);
  res.json({ secrets: rows });
});

// --- GET /api/secrets/:integration — one integration's rows ---
router.get('/:integration', (req, res) => {
  const { integration } = req.params;
  if (!INTEGRATIONS[integration]) return res.status(404).json({ error: 'Unknown integration' });
  const rows = secrets.list(req.session.userId, integration).map(enrichForClient);
  res.json({ integration, secrets: rows });
});

// --- POST /api/secrets/:integration — set one or more keys ---
// Body: { values: { keyName: stringValue, ... } }
router.post('/:integration', async (req, res) => {
  const { integration } = req.params;
  const values = (req.body && req.body.values) || {};
  if (!INTEGRATIONS[integration]) return res.status(404).json({ error: 'Unknown integration' });
  if (typeof values !== 'object' || Array.isArray(values)) {
    return res.status(400).json({ error: '`values` must be an object of key→string' });
  }
  const written = [];
  for (const [key, raw] of Object.entries(values)) {
    if (!isValidKey(integration, key)) {
      return res.status(400).json({ error: `Invalid key '${key}' for integration '${integration}'` });
    }
    const value = raw == null ? '' : String(raw);
    if (PLAINTEXT_KEYS.has(key)) {
      await secrets.upsert({
        userId: req.session.userId,
        integration, key,
        ciphertext: value, iv: 'PLAINTEXT', authTag: 'PLAINTEXT',
      });
    } else {
      if (value === '') {
        // Empty sensitive value — delete the existing row.
        const existing = secrets.byKey(req.session.userId, integration, key);
        if (existing) {
          await secrets.deleteByIntegration(req.session.userId, integration);
        }
      } else {
        const { ciphertext, iv, authTag } = encrypt(value);
        await secrets.upsert({
          userId: req.session.userId,
          integration, key,
          ciphertext, iv, authTag,
        });
      }
    }
    written.push(key);
  }
  await audit.log({
    userId: req.session.userId, userEmail: req.session.email,
    action: 'secrets.upsert', details: { integration, keys: written }, ip: req.ip,
  });
  // Return the post-write state so the client can refresh its UI in one round trip.
  const after = secrets.list(req.session.userId, integration).map(enrichForClient);
  res.json({ ok: true, integration, written, secrets: after });
});

// --- DELETE /api/secrets/:integration — wipe everything for an integration ---
router.delete('/:integration', async (req, res) => {
  const { integration } = req.params;
  if (!INTEGRATIONS[integration]) return res.status(404).json({ error: 'Unknown integration' });
  const removed = await secrets.deleteByIntegration(req.session.userId, integration);
  await audit.log({
    userId: req.session.userId, userEmail: req.session.email,
    action: 'secrets.delete', details: { integration, removed }, ip: req.ip,
  });
  res.json({ ok: true, removed });
});

// ----- Server-internal helpers (NOT exposed as HTTP routes) -----
// Proxy endpoints call these to read decrypted secrets.

export const readSecret = (userId, integration, key) => {
  const row = secrets.byKey(userId, integration, key);
  if (!row) return null;
  if (row.iv === 'PLAINTEXT') return row.ciphertext;
  try {
    return decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
  } catch (err) {
    console.error(`[secrets] decrypt failed for ${integration}.${key}:`, err.message);
    return null;
  }
};

export const readIntegration = (userId, integration) => {
  const rows = secrets.list(userId, integration);
  const out = {};
  for (const row of rows) {
    if (row.iv === 'PLAINTEXT') {
      out[row.key] = row.ciphertext;
    } else {
      try {
        out[row.key] = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
      } catch {
        out[row.key] = null;
      }
    }
  }
  return out;
};

// Server-internal upsert for tokens fetched by proxy endpoints (e.g.
// when DocuSign's exchange-code returns a fresh access_token, the proxy
// stores it via this helper rather than asking the client to round-trip).
export const writeSecret = async (userId, integration, key, value) => {
  if (!isValidKey(integration, key)) {
    throw new Error(`Invalid key '${key}' for integration '${integration}'`);
  }
  if (value == null || value === '') return null;
  if (PLAINTEXT_KEYS.has(key)) {
    return secrets.upsert({
      userId, integration, key,
      ciphertext: String(value), iv: 'PLAINTEXT', authTag: 'PLAINTEXT',
    });
  }
  const { ciphertext, iv, authTag } = encrypt(String(value));
  return secrets.upsert({ userId, integration, key, ciphertext, iv, authTag });
};

export default router;
