// ============================================================
// DocuSign JWT Grant authentication.
//
// One service account signs envelopes on behalf of Exceed Props
// Management Services. Credentials come from env vars — there is
// no per-user OAuth (that was removed when we moved to JWT).
//
// Token caching is in-memory and refreshes 5 minutes before the
// stated expiry so we never serve a near-expired token. Render
// dynos may cycle, in which case the next request just mints a
// new token — there's nothing to persist.
//
// BASE URI AUTODISCOVERY: In demo, every account lives on
// demo.docusign.net. In production, accounts are sharded across
// data centres (na1/na2/na3/na4/eu/au) and the right base URI
// isn't predictable. After minting the JWT we call /oauth/userinfo
// to find this account's actual `base_uri` and use it for all
// subsequent API calls. The env var DOCUSIGN_BASE_PATH is only
// a fallback if /userinfo fails.
// ============================================================
import docusign from 'docusign-esign';

const SCOPES = ['signature', 'impersonation'];
const REFRESH_LEAD_MS = 5 * 60 * 1000;
const PROD_OAUTH_HOST = 'account.docusign.com';

// The private key may arrive as a real multi-line PEM (typical
// when pasted into a .env file with quoting) or as a single line
// with literal "\n" sequences (typical when set via the Render
// dashboard's single-line input). Normalise both.
const normalizePrivateKey = (raw) => {
  if (!raw) return '';
  const s = String(raw).trim();
  // Strip surrounding single or double quotes if present.
  const unquoted = s.replace(/^['"]/, '').replace(/['"]$/, '');
  // Replace escaped newlines with real newlines.
  return unquoted.includes('\\n') ? unquoted.replace(/\\n/g, '\n') : unquoted;
};

// Inspect an env var's state without exposing its value. Returns
//   { state: 'set' | 'missing' | 'empty' | 'whitespace', length }
// 'set'         — defined and has non-whitespace content
// 'missing'     — not in process.env at all
// 'empty'       — defined as "" (empty string)
// 'whitespace'  — defined but only whitespace (trim() → "")
// Used for boot-time diagnostics and the /status fallback payload.
const envStatus = (name) => {
  const raw = process.env[name];
  if (raw === undefined) return { state: 'missing', length: 0 };
  if (raw === '') return { state: 'empty', length: 0 };
  if (String(raw).trim() === '') return { state: 'whitespace', length: raw.length };
  return { state: 'set', length: raw.length };
};

// Public: redacted snapshot of every DocuSign env var. Lengths but
// never values. Safe to log and to return in error responses.
export const envDiagnostics = () => ({
  DOCUSIGN_INTEGRATION_KEY: envStatus('DOCUSIGN_INTEGRATION_KEY'),
  DOCUSIGN_USER_ID:         envStatus('DOCUSIGN_USER_ID'),
  DOCUSIGN_ACCOUNT_ID:      envStatus('DOCUSIGN_ACCOUNT_ID'),
  DOCUSIGN_OAUTH_HOST:      envStatus('DOCUSIGN_OAUTH_HOST'),
  DOCUSIGN_BASE_PATH:       envStatus('DOCUSIGN_BASE_PATH'),
  DOCUSIGN_PRIVATE_KEY:     envStatus('DOCUSIGN_PRIVATE_KEY'),
  DOCUSIGN_WEBHOOK_SECRET:  envStatus('DOCUSIGN_WEBHOOK_SECRET'),
});

// Track which PEM-shape warnings we've already printed so the same
// gripe doesn't fire on every JWT refresh. Cleared when the env var
// changes (length comparison) so re-configuration immediately shows
// a fresh warning if the new value is still bad.
let _lastPemWarnedFor = null;
const warnIfBadPem = (pem) => {
  if (!pem) return;
  const looksLikePem = pem.includes('-----BEGIN ') && pem.includes('-----END ');
  if (looksLikePem) {
    _lastPemWarnedFor = null;
    return;
  }
  if (_lastPemWarnedFor === pem.length) return; // already warned about this exact bad value
  _lastPemWarnedFor = pem.length;
  // eslint-disable-next-line no-console
  console.warn(
    `[docusign] DOCUSIGN_PRIVATE_KEY does not look like a PEM ` +
    `(missing -----BEGIN.../-----END... markers). Length after normalisation: ${pem.length}. ` +
    `Most likely cause: a multi-line PEM was pasted into a single-line input, so only the first ` +
    `line was stored. Re-paste with \\n between lines, or use Render's multi-line var input. ` +
    `The JWT mint will fail with an SDK-level error after this warning.`,
  );
};

// Read env lazily so test scripts can change values between runs.
const readConfig = () => {
  // Distinguish missing / empty / whitespace per var so the error
  // tells the operator what to actually fix on Render, instead of
  // the misleading "missing X" when X is actually set to "".
  const required = ['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_USER_ID', 'DOCUSIGN_ACCOUNT_ID', 'DOCUSIGN_PRIVATE_KEY'];
  const issues = [];
  for (const name of required) {
    const s = envStatus(name);
    if (s.state !== 'set') {
      issues.push(`${name} is ${s.state}`);
    }
  }
  if (issues.length) {
    throw new Error(`DocuSign config: ${issues.join('; ')}`);
  }
  const cfg = {
    integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
    userId: process.env.DOCUSIGN_USER_ID,
    accountId: process.env.DOCUSIGN_ACCOUNT_ID,
    oauthHost: process.env.DOCUSIGN_OAUTH_HOST || 'account-d.docusign.com',
    // Fallback only — primary path is /oauth/userinfo autodiscovery.
    basePathFallback: process.env.DOCUSIGN_BASE_PATH || 'https://demo.docusign.net/restapi',
    privateKey: normalizePrivateKey(process.env.DOCUSIGN_PRIVATE_KEY),
  };
  warnIfBadPem(cfg.privateKey);
  return cfg;
};

// Public: returns true if the configured OAuth host is production.
// Used for boot-time logging and for the dev-mode safety warning.
export const isProduction = () =>
  (process.env.DOCUSIGN_OAUTH_HOST || 'account-d.docusign.com') === PROD_OAUTH_HOST;

// { accessToken, expiresAt, basePath } — base path discovered once
// per token and refreshed together with the token.
let cached = null;

// Surface DocuSign's nested error shape with a remediation hint.
// The SDK throws an Error whose .response.body is the raw response
// JSON; consent_required and invalid_grant both surface there.
//
// We always preserve:
//   e.code        — the upstream `error` field, or 'auth_failed' as fallback
//   e.statusCode  — HTTP status from the response, if any
//   e.upstream    — the raw response body (object or string), if any
//   e.sdkMessage  — the original SDK error message
// so logErr can print something usable even when the upstream body
// doesn't surface a known code. Outward-facing message stays generic
// in the wrapper (.message) — log lines look at .sdkMessage/.upstream.
const wrapAuthError = (err, oauthHost) => {
  const body = err?.response?.body || err?.response?.text || null;
  const statusCode = err?.response?.statusCode ?? err?.response?.status ?? null;
  const errCode =
    (body && typeof body === 'object' && body.error) ||
    (typeof body === 'string' && body.match(/"error"\s*:\s*"([^"]+)"/)?.[1]) ||
    null;
  // Helper to attach the diagnostic fields consistently.
  const attach = (e, code) => {
    e.code = code;
    e.statusCode = statusCode;
    e.upstream = body;
    e.sdkMessage = err?.message || null;
    return e;
  };
  if (errCode === 'consent_required') {
    let cfg;
    try { cfg = readConfig(); } catch { cfg = null; }
    const consentUrl = cfg
      ? `https://${oauthHost}/oauth/auth?response_type=code` +
        `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
        `&client_id=${encodeURIComponent(cfg.integrationKey)}` +
        // Redirect URI here is only used to land somewhere after consent;
        // the code itself is never exchanged. Any registered URL works.
        `&redirect_uri=${encodeURIComponent('https://www.docusign.com')}`
      : '(consent URL unavailable — readConfig failed)';
    return attach(
      new Error(
        `DocuSign consent required. Open this URL while logged in as the impersonated user and click Accept:\n  ${consentUrl}`,
      ),
      'consent_required',
    );
  }
  if (errCode === 'invalid_grant') {
    return attach(
      new Error(
        'DocuSign invalid_grant -- typical causes: (1) DOCUSIGN_USER_ID does not match the API user GUID, (2) DOCUSIGN_INTEGRATION_KEY/private key mismatch, (3) wrong DOCUSIGN_OAUTH_HOST for the environment, (4) clock skew on the server.',
      ),
      'invalid_grant',
    );
  }
  // Unknown — keep outward message generic, rely on .sdkMessage +
  // .upstream + .statusCode in logErr for the actual diagnostic info.
  return attach(
    new Error(`DocuSign JWT auth failed: ${err?.message || 'unknown error'}`),
    errCode || 'auth_failed',
  );
};

// Discover the per-account base URI via /oauth/userinfo. Returns
// the matching account's `${base_uri}/restapi` or null on any
// failure (caller falls back to env var).
const discoverBasePath = async (oauthHost, accessToken, accountId) => {
  try {
    const res = await fetch(`https://${oauthHost}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const info = await res.json();
    const accounts = Array.isArray(info?.accounts) ? info.accounts : [];
    // Match by account_id (string compare; both sides are GUIDs).
    const match = accounts.find(a => String(a.account_id) === String(accountId));
    if (!match || !match.base_uri) return null;
    return `${match.base_uri}/restapi`;
  } catch {
    return null;
  }
};

// Mint a fresh access token via JWT grant + discover the per-account
// base URI. Both go into the cache together so the next refresh
// re-discovers (account routing is stable but cheap to confirm).
const requestNewToken = async () => {
  const cfg = readConfig();
  const apiClient = new docusign.ApiClient();
  apiClient.setOAuthBasePath(cfg.oauthHost);
  let accessToken; let expiresInSec;
  try {
    const result = await apiClient.requestJWTUserToken(
      cfg.integrationKey,
      cfg.userId,
      SCOPES,
      Buffer.from(cfg.privateKey, 'utf8'),
      3600, // 1h — DocuSign max for JWT
    );
    accessToken = result?.body?.access_token;
    expiresInSec = Number(result?.body?.expires_in) || 3600;
    if (!accessToken) throw new Error('DocuSign returned no access_token');
  } catch (err) {
    throw wrapAuthError(err, cfg.oauthHost);
  }

  const discovered = await discoverBasePath(cfg.oauthHost, accessToken, cfg.accountId);
  if (!discovered) {
    // eslint-disable-next-line no-console
    console.warn(
      `[docusign] /oauth/userinfo base path discovery failed for account ${cfg.accountId}; ` +
      `falling back to DOCUSIGN_BASE_PATH=${cfg.basePathFallback}`,
    );
  }
  return {
    accessToken,
    expiresAt: Date.now() + expiresInSec * 1000,
    basePath: discovered || cfg.basePathFallback,
  };
};

// Public: return a valid access token, refreshing if needed.
export const getAccessToken = async () => {
  const now = Date.now();
  if (cached && cached.expiresAt - REFRESH_LEAD_MS > now) {
    return cached.accessToken;
  }
  cached = await requestNewToken();
  return cached.accessToken;
};

// Public: return an ApiClient configured with the (discovered)
// API base path and a fresh bearer token in the Authorization header.
export const getApiClient = async () => {
  const cfg = readConfig();
  // Ensure cache is populated (this also discovers the base path).
  await getAccessToken();
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(cached.basePath);
  apiClient.addDefaultHeader('Authorization', `Bearer ${cached.accessToken}`);
  return { apiClient, accountId: cfg.accountId, basePath: cached.basePath };
};

// Test hook — lets the auth test script clear the cache to force
// a real round-trip even if a token was minted recently.
export const _clearTokenCache = () => { cached = null; };

// Test hook — read the cached base path. Useful for assertions in
// the smoke test that confirm discovery worked.
export const _getCachedBasePath = () => (cached ? cached.basePath : null);
