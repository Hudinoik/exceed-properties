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
// ============================================================
import docusign from 'docusign-esign';

const SCOPES = ['signature', 'impersonation'];
const REFRESH_LEAD_MS = 5 * 60 * 1000;

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
    basePath: process.env.DOCUSIGN_BASE_PATH || 'https://demo.docusign.net/restapi',
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

let cached = null; // { accessToken, expiresAt }

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

// Mint a fresh access token via JWT grant. Caller is expected to
// have validated config already.
const requestNewToken = async () => {
  const cfg = readConfig();
  const apiClient = new docusign.ApiClient();
  apiClient.setOAuthBasePath(cfg.oauthHost);
  try {
    const result = await apiClient.requestJWTUserToken(
      cfg.integrationKey,
      cfg.userId,
      SCOPES,
      Buffer.from(cfg.privateKey, 'utf8'),
      3600, // 1h — DocuSign max for JWT
    );
    const accessToken = result?.body?.access_token;
    const expiresInSec = Number(result?.body?.expires_in) || 3600;
    if (!accessToken) throw new Error('DocuSign returned no access_token');
    return {
      accessToken,
      expiresAt: Date.now() + expiresInSec * 1000,
    };
  } catch (err) {
    throw wrapAuthError(err, cfg.oauthHost);
  }
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

// Public: return an ApiClient configured with the API base path
// and a fresh bearer token in the Authorization header.
export const getApiClient = async () => {
  const cfg = readConfig();
  const accessToken = await getAccessToken();
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(cfg.basePath);
  apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);
  return { apiClient, accountId: cfg.accountId };
};

// Test hook — lets the auth test script clear the cache to force
// a real round-trip even if a token was minted recently.
export const _clearTokenCache = () => { cached = null; };
