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
// DocuSign — see server/routes/docusign.js and server/docusign/*.
//
// The DocuSign integration was migrated from per-user OAuth to a
// single JWT service account. Routes live at /api/docusign/* and
// the Connect webhook receiver is in routes/webhooks.js.
// ----------------------------------------------------------------

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

// Path validation — used by both /get and /probe.
const isValidPIPath = (p) =>
  typeof p === 'string' &&
  p.startsWith('/') &&
  !p.includes('..') &&
  !p.startsWith('/oauth') &&
  !/[\x00-\x1f]/.test(p);

// Refresh the PI access token if it has expired (or expires within 30s).
// Returns the current/refreshed token, or null if no refresh is possible.
// Persists refreshed tokens to the vault so the next request reuses them.
const ensurePIToken = async (userId) => {
  const cfg = readIntegration(userId, 'propertyInspect');
  if (!cfg.accessToken) return { token: null, reason: 'no-token' };
  const expiry = Number(cfg.tokenExpiry || 0);
  // If the token still has more than 30s to live, reuse it.
  if (expiry && Date.now() < expiry - 30 * 1000) {
    return { token: cfg.accessToken, reason: 'cached' };
  }
  // Expired -- try the refresh_token flow.
  if (!cfg.refreshToken || !cfg.clientId || !cfg.clientSecret) {
    return { token: cfg.accessToken, reason: 'expired-no-refresh' };
  }
  const tokenUrl = cfg.tokenUrl || 'https://api.propertyinspect.com/oauth/token';
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    const r = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { token: null, reason: `refresh-failed: HTTP ${r.status} ${text.slice(0, 200)}` };
    }
    const tokens = await r.json();
    if (!tokens.access_token) return { token: null, reason: 'refresh-no-token' };
    await writeSecret(userId, 'propertyInspect', 'accessToken', tokens.access_token);
    if (tokens.refresh_token) await writeSecret(userId, 'propertyInspect', 'refreshToken', tokens.refresh_token);
    const newExpiry = String(Date.now() + Math.max(60, (tokens.expires_in || 3600) - 30) * 1000);
    await writeSecret(userId, 'propertyInspect', 'tokenExpiry', newExpiry);
    return { token: tokens.access_token, reason: 'refreshed' };
  } catch (err) {
    return { token: null, reason: `refresh-error: ${err.message}` };
  }
};

// Test connection: refresh-if-needed + hit /me (scope-less on Laravel
// Passport). Returns enough info that the integration card can show
// {connected: true, accountEmail, scopes?} or a precise error.
router.post('/property-inspect/test', async (req, res) => {
  const { token, reason } = await ensurePIToken(req.session.userId);
  if (!token) {
    return res.status(401).json({ ok: false, error: `No usable PI token (${reason}). Re-run Connect.` });
  }
  const cfg = readIntegration(req.session.userId, 'propertyInspect');
  const base = cfg.baseUrl || 'https://api.propertyinspect.com';
  try {
    const upstream = await fetch(`${base}/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const text = await upstream.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    if (!upstream.ok) {
      const wwwAuth = upstream.headers.get('www-authenticate') || '';
      return res.status(upstream.status).json({
        ok: false,
        error: body?.message || body?.error || `HTTP ${upstream.status}`,
        wwwAuthenticate: wwwAuth || undefined,
      });
    }
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'proxy.pi.test', details: { ok: true, refreshReason: reason }, ip: req.ip,
    });
    res.json({
      ok: true,
      refreshReason: reason,
      account: {
        id: body?.id || body?.user?.id || null,
        name: body?.name || body?.user?.name || null,
        email: body?.email || body?.user?.email || null,
      },
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Single-path GET forwarder. Path is sanitized to prevent access to
// non-data endpoints (no `/oauth/*`, no traversal).
router.get('/property-inspect/get', async (req, res) => {
  const { token, reason } = await ensurePIToken(req.session.userId);
  if (!token) {
    return res.status(401).json({ error: `No usable PI token: ${reason}` });
  }
  const cfg = readIntegration(req.session.userId, 'propertyInspect');
  const targetPath = String(req.query.path || '/inspections');
  if (!isValidPIPath(targetPath)) {
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

// Batch probe — accepts a list of paths, fires them in parallel against
// PI, and returns a per-path report ({ ok, status, body|message }). Used
// by the integration card's Pull Inspections so 9 separate browser→Render
// round-trips collapse into one, and the underlying PI calls run in
// parallel server-side instead of being serialized by client awaits.
router.post('/property-inspect/probe', async (req, res) => {
  const { token, reason } = await ensurePIToken(req.session.userId);
  if (!token) {
    return res.status(401).json({ error: `No usable PI token: ${reason}` });
  }
  const cfg = readIntegration(req.session.userId, 'propertyInspect');
  const base = cfg.baseUrl || 'https://api.propertyinspect.com';
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  if (paths.length === 0) return res.status(400).json({ error: 'paths[] required' });
  if (paths.length > 20) return res.status(400).json({ error: 'too many paths (max 20)' });
  const invalid = paths.filter(p => !isValidPIPath(p));
  if (invalid.length) return res.status(400).json({ error: `invalid path(s): ${invalid.join(', ')}` });

  // Fire all PI requests concurrently. Each is independent; we don't want
  // a slow endpoint to delay the rest. 25s budget per request is generous
  // — if PI hangs longer than that we'd rather see a clean timeout in the
  // report than have Render's HTTP layer kill the whole probe with a 502.
  const probeOne = async (p) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const upstream = await fetch(`${base}${p}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: ctrl.signal,
      });
      const text = await upstream.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
      return {
        ok: upstream.status >= 200 && upstream.status < 300,
        status: upstream.status,
        body: json !== null ? json : { raw: text.slice(0, 2000) },
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        message: err.name === 'AbortError' ? 'timeout (>25s)' : err.message,
      };
    } finally {
      clearTimeout(timer);
    }
  };
  const results = await Promise.all(paths.map(probeOne));
  const report = {};
  paths.forEach((p, i) => { report[p] = results[i]; });
  res.json({ report });
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

// Generic Jibble GET forwarder. Path validation is intentionally minimal —
// must start with `/`, no path-traversal, no control chars. The path may
// include query parameters with OData syntax ($top, $filter, etc.) which
// involves spaces, `+`, `?`, `$`, `&` — too brittle to whitelist.
router.get('/jibble/get', async (req, res) => {
  const targetPath = String(req.query.path || '/People');
  const which = String(req.query.svc || 'workspace'); // workspace | time
  if (
    !targetPath.startsWith('/') ||
    targetPath.includes('..') ||
    /[\x00-\x1f]/.test(targetPath)
  ) {
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

// Jibble write forwarder. Used by the Time Tracking page's "Adjust" UI to
// create / update / delete time entries. Restricted to TimeEntries paths so
// we don't open up the whole Jibble surface area through the proxy.
router.post('/jibble/write', async (req, res) => {
  const { method = 'POST', path: targetPath = '/TimeEntries', svc = 'time', body = {} } = req.body || {};
  const upperMethod = String(method).toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod)) {
    return res.status(400).json({ error: `Method ${upperMethod} not allowed` });
  }
  if (
    typeof targetPath !== 'string' ||
    !targetPath.startsWith('/TimeEntries') ||
    targetPath.includes('..') ||
    /[\x00-\x1f]/.test(targetPath)
  ) {
    return res.status(400).json({ error: 'Invalid path (must start with /TimeEntries)' });
  }
  const base = svc === 'workspace' ? JIBBLE_API : JIBBLE_TIME;
  try {
    const accessToken = await ensureJibbleToken(req.session.userId);
    const hasBody = upperMethod !== 'DELETE' && body && Object.keys(body).length > 0;
    const upstream = await fetch(`${base}${targetPath}`, {
      method: upperMethod,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    const text = await upstream.text();
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'proxy.jibble.write',
      details: { method: upperMethod, path: targetPath, status: upstream.status },
      ip: req.ip,
    });
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text || '{}');
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
