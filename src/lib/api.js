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
    // Laravel-style upstream responses (Property Inspect etc.) use `message`,
    // not `error`. Surface whichever is present so callers can show the
    // actual reason instead of a generic "HTTP 401".
    const msg = json?.error || json?.message || `HTTP ${res.status}`;
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
  // DocuSign now uses a single JWT service account (see server/docusign/).
  // The per-user OAuth helpers (docusignExchangeCode etc.) have been removed.
  async docusignGetStatus() {
    return request('/api/docusign/status');
  },
  async docusignSendTestEnvelope({ name, email }) {
    return request('/api/docusign/test-envelope', {
      method: 'POST',
      body: { name, email },
    });
  },
  async docusignSendLease({ signers, pdfBase64, emailSubject, documentName }) {
    return request('/api/docusign/send-lease', {
      method: 'POST',
      body: { signers, pdfBase64, emailSubject, documentName },
    });
  },
  async docusignRemindEnvelope(envelopeId) {
    return request(`/api/docusign/envelopes/${encodeURIComponent(envelopeId)}/remind`, {
      method: 'POST',
    });
  },
  async docusignSendFromTemplate({ templateId, signerName, signerEmail, roleName, emailSubject }) {
    return request('/api/docusign/send-from-template', {
      method: 'POST',
      body: { templateId, signerName, signerEmail, roleName, emailSubject },
    });
  },
  async docusignGetEnvelope(envelopeId) {
    return request(`/api/docusign/envelopes/${encodeURIComponent(envelopeId)}`);
  },
  async docusignListEnvelopes({ fromDate } = {}) {
    const qs = fromDate ? `?fromDate=${encodeURIComponent(fromDate)}` : '';
    return request(`/api/docusign/envelopes${qs}`);
  },
  async docusignListRecipients(envelopeId) {
    return request(`/api/docusign/envelopes/${encodeURIComponent(envelopeId)}/recipients`);
  },
  async docusignListEnvelopeDocuments(envelopeId) {
    return request(`/api/docusign/envelopes/${encodeURIComponent(envelopeId)}/documents`);
  },
  // Returns a Blob of the signed PDF — use FileSaver/etc. to hand it to
  // the user. We don't use request() here because the response isn't JSON.
  async docusignDownloadEnvelopeDocument(envelopeId, documentId = 'combined') {
    const csrf = (() => {
      if (typeof document === 'undefined') return '';
      const m = document.cookie.split('; ').find(r => r.startsWith('ep.csrf='));
      return m ? decodeURIComponent(m.split('=')[1]) : '';
    })();
    const url = `/api/docusign/envelopes/${encodeURIComponent(envelopeId)}/document?documentId=${encodeURIComponent(documentId)}`;
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrf },
    });
    if (!res.ok) {
      let msg;
      try { const j = await res.json(); msg = j?.error || `HTTP ${res.status}`; }
      catch { msg = `HTTP ${res.status}`; }
      throw new ApiError(msg, res.status, null);
    }
    return res.blob();
  },
  async docusignWebhookEvents(limit = 100) {
    const r = await request(`/api/webhooks/docusign/events?limit=${limit}`);
    return r.events || [];
  },
  async docusignWebhookClear() {
    return request('/api/webhooks/docusign/events', { method: 'DELETE' });
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
  async piProbe(paths) {
    return request('/api/proxy/property-inspect/probe', {
      method: 'POST',
      body: { paths },
    });
  },
  async piWebhookEvents(limit = 100) {
    const r = await request(`/api/webhooks/property-inspect/events?limit=${limit}`);
    return r.events || [];
  },
  async piWebhookClear() {
    return request('/api/webhooks/property-inspect/events', { method: 'DELETE' });
  },
  async jibbleTest() {
    return request('/api/proxy/jibble/test', { method: 'POST', body: {} });
  },
  async jibbleGet(path, svc = 'workspace') {
    return request(`/api/proxy/jibble/get?path=${encodeURIComponent(path)}&svc=${encodeURIComponent(svc)}`);
  },
  async jibbleWrite({ method, path, body = {}, svc = 'time' }) {
    return request('/api/proxy/jibble/write', {
      method: 'POST',
      body: { method, path, body, svc },
    });
  },
};

// --- Lease packs (the end-to-end leasing workflow) ---
export const packs = {
  async list({ archived = false } = {}) {
    const qs = archived ? '?archived=1' : '';
    const r = await request(`/api/packs${qs}`);
    return r.packs || [];
  },
  async get(packId) {
    const r = await request(`/api/packs/${encodeURIComponent(packId)}`);
    return r.pack;
  },
  async create(pack) {
    const r = await request('/api/packs', { method: 'POST', body: pack });
    return r.pack;
  },
  async update(packId, patch) {
    const r = await request(`/api/packs/${encodeURIComponent(packId)}`, {
      method: 'PATCH', body: patch,
    });
    return r.pack;
  },
  async transition(packId, toStage, reason) {
    const r = await request(`/api/packs/${encodeURIComponent(packId)}/stage`, {
      method: 'POST', body: { toStage, reason },
    });
    return r.pack;
  },
  async saveDraft(packId, { docxBase64, pdfBase64 }) {
    const r = await request(`/api/packs/${encodeURIComponent(packId)}/draft`, {
      method: 'POST', body: { docxBase64, pdfBase64 },
    });
    return r.pack;
  },
  async sendToDocusign(packId) {
    const r = await request(`/api/packs/${encodeURIComponent(packId)}/send-to-docusign`, {
      method: 'POST', body: {},
    });
    return r;
  },
  async resendReminder(packId) {
    return request(`/api/packs/${encodeURIComponent(packId)}/resend-reminder`, {
      method: 'POST', body: {},
    });
  },
  async voidEnvelope(packId, reason) {
    const r = await request(`/api/packs/${encodeURIComponent(packId)}/void-envelope`, {
      method: 'POST', body: { reason },
    });
    return r.pack;
  },
  async markLoaded(packId, propertyInspectRef) {
    const r = await request(`/api/packs/${encodeURIComponent(packId)}/mark-loaded`, {
      method: 'POST', body: { propertyInspectRef },
    });
    return r.pack;
  },
  async addComment(packId, body) {
    const r = await request(`/api/packs/${encodeURIComponent(packId)}/comments`, {
      method: 'POST', body: { body },
    });
    return r.comment;
  },
  // Files are returned as Blob -- use FileSaver/etc. to surface them.
  async downloadFile(packId, fileType) {
    const csrf = (() => {
      if (typeof document === 'undefined') return '';
      const m = document.cookie.split('; ').find(r => r.startsWith('ep.csrf='));
      return m ? decodeURIComponent(m.split('=')[1]) : '';
    })();
    const url = `/api/packs/${encodeURIComponent(packId)}/files/${encodeURIComponent(fileType)}`;
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrf },
    });
    if (!res.ok) {
      let msg;
      try { const j = await res.json(); msg = j?.error || `HTTP ${res.status}`; }
      catch { msg = `HTTP ${res.status}`; }
      throw new ApiError(msg, res.status, null);
    }
    return res.blob();
  },
};

// Convenience: flatten a secrets array into an object {key: {hasValue, last4, ...}}
// for easy access from React components.
export const secretsToMap = (rows) => {
  const out = {};
  (rows || []).forEach(r => { out[r.key] = r; });
  return out;
};
