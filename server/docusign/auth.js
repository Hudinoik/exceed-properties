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

// Read env lazily so test scripts can change values between runs.
const readConfig = () => {
  const cfg = {
    integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
    userId: process.env.DOCUSIGN_USER_ID,
    accountId: process.env.DOCUSIGN_ACCOUNT_ID,
    oauthHost: process.env.DOCUSIGN_OAUTH_HOST || 'account-d.docusign.com',
    // Fallback only — primary path is /oauth/userinfo autodiscovery.
    basePathFallback: process.env.DOCUSIGN_BASE_PATH || 'https://demo.docusign.net/restapi',
    privateKey: normalizePrivateKey(process.env.DOCUSIGN_PRIVATE_KEY),
  };
  const missing = [];
  if (!cfg.integrationKey) missing.push('DOCUSIGN_INTEGRATION_KEY');
  if (!cfg.userId) missing.push('DOCUSIGN_USER_ID');
  if (!cfg.accountId) missing.push('DOCUSIGN_ACCOUNT_ID');
  if (!cfg.privateKey) missing.push('DOCUSIGN_PRIVATE_KEY');
  if (missing.length) {
    throw new Error(`DocuSign config is incomplete: missing ${missing.join(', ')}`);
  }
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
const wrapAuthError = (err, oauthHost) => {
  const body = err?.response?.body || err?.response?.text || null;
  const errCode =
    (body && typeof body === 'object' && body.error) ||
    (typeof body === 'string' && body.match(/"error"\s*:\s*"([^"]+)"/)?.[1]) ||
    null;
  if (errCode === 'consent_required') {
    const cfg = readConfig();
    const consentUrl =
      `https://${oauthHost}/oauth/auth?response_type=code` +
      `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
      `&client_id=${encodeURIComponent(cfg.integrationKey)}` +
      // Redirect URI here is only used to land somewhere after consent;
      // the code itself is never exchanged. Any registered URL works.
      `&redirect_uri=${encodeURIComponent('https://www.docusign.com')}`;
    const e = new Error(
      `DocuSign consent required. Open this URL while logged in as the impersonated user and click Accept:\n  ${consentUrl}`,
    );
    e.code = 'consent_required';
    return e;
  }
  if (errCode === 'invalid_grant') {
    const e = new Error(
      'DocuSign invalid_grant — typical causes: (1) DOCUSIGN_USER_ID does not match the API user GUID, (2) DOCUSIGN_INTEGRATION_KEY/private key mismatch, (3) wrong DOCUSIGN_OAUTH_HOST for the environment, (4) clock skew on the server.',
    );
    e.code = 'invalid_grant';
    return e;
  }
  // Unknown — surface the raw body to the server logs but keep the
  // outward-facing message generic.
  const e = new Error(`DocuSign JWT auth failed: ${err.message || 'unknown error'}`);
  e.code = errCode || 'auth_failed';
  e.upstream = body;
  return e;
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
