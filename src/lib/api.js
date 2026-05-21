// ============================================================
// Frontend API client.
//
// Single source of truth for all backend calls. Handles:
//   - CSRF: reads the ep.csrf cookie and echoes it as X-CSRF-Token on
//     every mutating request.
//   - credentials: 'include' so the session cookie always rides along.
//   - JSON encoding + 4xx/5xx error normalization.
//
// All API responses are plain JSON. Errors throw an ApiError with the
// HTTP status code and the server's error message, so callers can
// distinguish 401 (logged out) from 403 (CSRF/permission) from 500.
// ============================================================

const readCookie = (name) => {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split('; ').find(row => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : '';
};

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const opts = {
    method,
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      ...headers,
    },
  };
  // Attach CSRF token on mutating verbs. The cookie is set automatically
  // on the first GET, so by the time the user submits a form it's available.
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie('ep.csrf');
    if (csrf) opts.headers['X-CSRF-Token'] = csrf;
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    throw new ApiError(`Network error: ${err.message}`, 0, null);
  }
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); }
    catch { /* non-JSON response */ }
  }
  if (!res.ok) {
    const msg = json?.error || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, json);
  }
  return json;
};

// --- Auth ---
export const auth = {
  async me() {
    const r = await request('/api/auth/me');
    return r.user || null;
  },
  async login(email, password) {
    const r = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    return r.user;
  },
  async logout() {
    await request('/api/auth/logout', { method: 'POST' });
  },
  async changePassword({ currentPassword, newPassword }) {
    return request('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  },
};

// --- Secrets vault ---
export const secrets = {
  async listAll() {
    const r = await request('/api/secrets');
    return r.secrets || [];
  },
  async get(integration) {
    const r = await request(`/api/secrets/${encodeURIComponent(integration)}`);
    return r.secrets || [];
  },
  async set(integration, values) {
    const r = await request(`/api/secrets/${encodeURIComponent(integration)}`, {
      method: 'POST',
      body: { values },
    });
    return r.secrets || [];
  },
  async clear(integration) {
    return request(`/api/secrets/${encodeURIComponent(integration)}`, { method: 'DELETE' });
  },
};

// --- Proxy (server-side calls to external APIs) ---
export const proxy = {
  async anthropicMessages(messageBody) {
    return request('/api/proxy/anthropic/messages', {
      method: 'POST',
      body: messageBody,
    });
  },
  async docusignExchangeCode(code) {
    return request('/api/proxy/docusign/exchange-code', {
      method: 'POST',
      body: { code },
    });
  },
  async docusignCreateEnvelope(envelope) {
    return request('/api/proxy/docusign/create-envelope', {
      method: 'POST',
      body: { envelope },
    });
  },
  async docusignGetEnvelope(id) {
    return request(`/api/proxy/docusign/envelope/${encodeURIComponent(id)}`);
  },
  async piExchangeCode(code) {
    return request('/api/proxy/property-inspect/exchange-code', {
      method: 'POST',
      body: { code },
    });
  },
  async piGet(path) {
    return request(`/api/proxy/property-inspect/get?path=${encodeURIComponent(path)}`);
  },
  async jibbleTest() {
    return request('/api/proxy/jibble/test', { method: 'POST', body: {} });
  },
  async jibbleGet(path, svc = 'workspace') {
    return request(`/api/proxy/jibble/get?path=${encodeURIComponent(path)}&svc=${encodeURIComponent(svc)}`);
  },
};

// Convenience: flatten a secrets array into an object {key: {hasValue, last4, ...}}
// for easy access from React components.
export const secretsToMap = (rows) => {
  const out = {};
  (rows || []).forEach(r => { out[r.key] = r; });
  return out;
};
