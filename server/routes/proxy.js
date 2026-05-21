// ============================================================
// Server-side proxies for sensitive external APIs.
//
// Every endpoint here:
//   1. Requires an authenticated session (requireAuth).
//   2. Pulls the relevant secrets from the per-user vault.
//   3. Calls the upstream API server-side, so API keys / OAuth tokens
//      NEVER leave the server.
//   4. Returns only what the client needs to render the result.
//
// This is the core of the security model. Once these endpoints work,
// the SPA can be served read-only credentials (metadata only) and the
// real API calls happen behind the auth wall.
// ============================================================
import express from 'express';
import { requireAuth } from './auth.js';
import { readIntegration, writeSecret } from './secrets.js';
import { audit } from '../db.js';

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------
// Anthropic (Claude API)
// ----------------------------------------------------------------
// The SPA POSTs to /api/proxy/anthropic/messages with the same body
// shape as the Anthropic /v1/messages endpoint. We attach the API key
// server-side and forward. Response body is passed through.
router.post('/anthropic/messages', async (req, res) => {
  const cfg = readIntegration(req.session.userId, 'anthropic');
  if (!cfg.apiKey) {
    return res.status(400).json({ error: 'Anthropic API key is not configured for this user' });
  }
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'proxy.anthropic.messages', details: { status: upstream.status }, ip: req.ip,
    });
  } catch (err) {
    res.status(502).json({ error: `Anthropic call failed: ${err.message}` });
  }
});

// ----------------------------------------------------------------
// DocuSign — OAuth code exchange + envelope creation
// ----------------------------------------------------------------
const docusignAuthHost = (env) => env === 'prod' ? 'https://account.docusign.com' : 'https://account-d.docusign.com';

router.post('/docusign/exchange-code', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });
  const cfg = readIntegration(req.session.userId, 'docusign');
  if (!cfg.integrationKey || !cfg.clientSecret || !cfg.redirectUri) {
    return res.status(400).json({ error: 'DocuSign integration is not configured' });
  }
  const env = cfg.environment || 'demo';
  try {
    const basic = Buffer.from(`${cfg.integrationKey}:${cfg.clientSecret}`).toString('base64');
    const tokenRes = await fetch(`${docusignAuthHost(env)}/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
      }).toString(),
    });
    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '');
      return res.status(tokenRes.status).json({ error: `DocuSign token exchange failed: ${txt}` });
    }
    const tokens = await tokenRes.json();
    // Fetch /userinfo to discover accountId + base_uri.
    const infoRes = await fetch(`${docusignAuthHost(env)}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = infoRes.ok ? await infoRes.json() : null;
    const acct = info?.accounts?.find(a => a.is_default) || info?.accounts?.[0] || null;
    // Persist server-side so the browser never sees the access token.
    await writeSecret(req.session.userId, 'docusign', 'accessToken', tokens.access_token);
    if (tokens.refresh_token) {
      await writeSecret(req.session.userId, 'docusign', 'refreshToken', tokens.refresh_token);
    }
    const expiry = String(Date.now() + Math.max(60, (tokens.expires_in || 3600) - 30) * 1000);
    await writeSecret(req.session.userId, 'docusign', 'tokenExpiry', expiry);
    if (acct) {
      await writeSecret(req.session.userId, 'docusign', 'accountId', acct.account_id);
      await writeSecret(req.session.userId, 'docusign', 'baseUri', `${acct.base_uri}/restapi`);
    }
    if (info?.email) await writeSecret(req.session.userId, 'docusign', 'userEmail', info.email);
    if (info?.sub) await writeSecret(req.session.userId, 'docusign', 'userId', info.sub);
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'proxy.docusign.connected', details: { accountId: acct?.account_id || null }, ip: req.ip,
    });
    res.json({
      ok: true,
      accountId: acct?.account_id || null,
      baseUri: acct ? `${acct.base_uri}/restapi` : null,
      userEmail: info?.email || null,
    });
  } catch (err) {
    res.status(502).json({ error: `DocuSign exchange failed: ${err.message}` });
  }
});

// Helper that returns a fresh DocuSign access token, refreshing if needed.
const ensureDocuSignToken = async (userId) => {
  const cfg = readIntegration(userId, 'docusign');
  const now = Date.now();
  if (cfg.accessToken && cfg.tokenExpiry && now < Number(cfg.tokenExpiry)) {
    return { accessToken: cfg.accessToken, cfg };
  }
  if (!cfg.refreshToken) throw new Error('No DocuSign access token available; reconnect required.');
  const env = cfg.environment || 'demo';
  const basic = Buffer.from(`${cfg.integrationKey}:${cfg.clientSecret}`).toString('base64');
  const r = await fetch(`${docusignAuthHost(env)}/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken }).toString(),
  });
  if (!r.ok) throw new Error(`DocuSign refresh failed (${r.status})`);
  const tokens = await r.json();
  await writeSecret(userId, 'docusign', 'accessToken', tokens.access_token);
  if (tokens.refresh_token) await writeSecret(userId, 'docusign', 'refreshToken', tokens.refresh_token);
  const expiry = String(Date.now() + Math.max(60, (tokens.expires_in || 3600) - 30) * 1000);
  await writeSecret(userId, 'docusign', 'tokenExpiry', expiry);
  return { accessToken: tokens.access_token, cfg: { ...cfg, accessToken: tokens.access_token } };
};

router.post('/docusign/create-envelope', async (req, res) => {
  const { envelope } = req.body || {};
  if (!envelope || typeof envelope !== 'object') {
    return res.status(400).json({ error: '`envelope` body is required' });
  }
  try {
    const { accessToken, cfg } = await ensureDocuSignToken(req.session.userId);
    if (!cfg.accountId || !cfg.baseUri) {
      return res.status(400).json({ error: 'DocuSign accountId/baseUri missing; reconnect required.' });
    }
    const url = `${cfg.baseUri}/v2.1/accounts/${encodeURIComponent(cfg.accountId)}/envelopes`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(envelope),
    });
    const text = await upstream.text();
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'proxy.docusign.create-envelope', details: { status: upstream.status }, ip: req.ip,
    });
    res.status(upstream.status).type('application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: `DocuSign envelope creation failed: ${err.message}` });
  }
});

router.get('/docusign/envelope/:id', async (req, res) => {
  try {
    const { accessToken, cfg } = await ensureDocuSignToken(req.session.userId);
    const url = `${cfg.baseUri}/v2.1/accounts/${encodeURIComponent(cfg.accountId)}/envelopes/${encodeURIComponent(req.params.id)}`;
    const upstream = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Property Inspect — OAuth code exchange + read-only API forwarding
// ----------------------------------------------------------------
router.post('/property-inspect/exchange-code', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });
  const cfg = readIntegration(req.session.userId, 'propertyInspect');
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    return res.status(400).json({ error: 'Property Inspect integration is not configured' });
  }
  const tokenUrl = cfg.tokenUrl || 'https://api.propertyinspect.com/oauth/token';
  try {
    const r = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        code,
      }).toString(),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({ error: `PI token exchange failed: ${txt}` });
    }
    const tokens = await r.json();
    await writeSecret(req.session.userId, 'propertyInspect', 'accessToken', tokens.access_token);
    if (tokens.refresh_token) await writeSecret(req.session.userId, 'propertyInspect', 'refreshToken', tokens.refresh_token);
    const expiry = String(Date.now() + Math.max(60, (tokens.expires_in || 3600) - 30) * 1000);
    await writeSecret(req.session.userId, 'propertyInspect', 'tokenExpiry', expiry);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `PI exchange failed: ${err.message}` });
  }
});

// Generic GET-only forwarder for PI. Path is sanitized to prevent
// access to non-/data endpoints (no `/oauth/*`, no traversal).
router.get('/property-inspect/get', async (req, res) => {
  const cfg = readIntegration(req.session.userId, 'propertyInspect');
  if (!cfg.accessToken) {
    return res.status(400).json({ error: 'No PI token available' });
  }
  const token = cfg.accessToken;
  const targetPath = String(req.query.path || '/inspections');
  if (!/^\/[a-zA-Z0-9_\-./]+$/.test(targetPath) || targetPath.includes('..') || targetPath.startsWith('/oauth')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  const base = cfg.baseUrl || 'https://api.propertyinspect.com';
  try {
    const upstream = await fetch(`${base}${targetPath}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Jibble — OAuth 2 Client Credentials.
// The token endpoint refuses browser-origin requests (CORS), so the
// browser MUST go through this proxy. Stored secrets stay in the vault.
// ----------------------------------------------------------------
const JIBBLE_IDENTITY = 'https://identity.prod.jibble.io/connect/token';
const JIBBLE_API = 'https://workspace.prod.jibble.io/v1';
const JIBBLE_TIME = 'https://time-tracking.prod.jibble.io/v1';

const ensureJibbleToken = async (userId) => {
  const cfg = readIntegration(userId, 'jibble');
  const now = Date.now();
  if (cfg.accessToken && cfg.tokenExpiry && now < Number(cfg.tokenExpiry)) {
    return cfg.accessToken;
  }
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('Jibble Client ID + Secret are not configured');
  }
  const r = await fetch(JIBBLE_IDENTITY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }).toString(),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Jibble token exchange failed (HTTP ${r.status}): ${text || r.statusText}`);
  }
  const tokens = await r.json();
  if (!tokens.access_token) throw new Error('Jibble returned no access_token');
  await writeSecret(userId, 'jibble', 'accessToken', tokens.access_token);
  const expiry = String(Date.now() + Math.max(60, (tokens.expires_in || 3600) - 30) * 1000);
  await writeSecret(userId, 'jibble', 'tokenExpiry', expiry);
  return tokens.access_token;
};

// Test connection: exchange creds + probe /People with $top=1.
router.post('/jibble/test', async (req, res) => {
  try {
    const accessToken = await ensureJibbleToken(req.session.userId);
    const url = `${JIBBLE_API}/People?$top=1`;
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data?.message || `Jibble /People returned HTTP ${upstream.status}` });
    }
    const peopleCount = Array.isArray(data?.value) ? data.value.length : (data?.['@odata.count'] || 0);
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'proxy.jibble.test', details: { ok: true }, ip: req.ip,
    });
    res.json({ ok: true, peopleCount });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Generic Jibble GET forwarder. Path is whitelisted — only workspace + time-tracking
// resource endpoints are allowed.
router.get('/jibble/get', async (req, res) => {
  const targetPath = String(req.query.path || '/People');
  const which = String(req.query.svc || 'workspace'); // workspace | time
  if (!/^\/[A-Za-z0-9_\-./()$=&,]+$/.test(targetPath) || targetPath.includes('..')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  const base = which === 'time' ? JIBBLE_TIME : JIBBLE_API;
  try {
    const accessToken = await ensureJibbleToken(req.session.userId);
    const upstream = await fetch(`${base}${targetPath}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
