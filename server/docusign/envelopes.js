// ============================================================
// DocuSign envelope operations.
//
// All functions in here assume getApiClient() has been wired up
// with a fresh JWT token; they never read env vars directly.
// Errors from the SDK are normalised so callers see a clean
// Error.message and (optionally) Error.upstream with the parsed
// DocuSign response body for the server logs.
// ============================================================
import fs from 'node:fs';
import docusign from 'docusign-esign';
import { getApiClient, isProduction } from './auth.js';

// Anchor strings are derived from the signer's role, matching the
// template constants in src/App.jsx (DOCUSIGN_ANCHORS). Format:
//   \sig_<role>\   \date_<role>\   \name_<role>\   \init_<role>\
// Roles: landlord, tenant, or surety_<n> / witness_<n> for multiple
// sureties/witnesses (1-based, e.g. surety_1, surety_2). The lease
// DOCX template renders these anchors in white size-1 text so
// DocuSign locates them but they don't show in the final document.
const ROLE_REGEX = /^(landlord|tenant|(surety|witness)(_\d+)?)$/;
const anchorsFor = (role) => ({
  sig:  `\\sig_${role}\\`,
  date: `\\date_${role}\\`,
  name: `\\name_${role}\\`,
  init: `\\init_${role}\\`,
});

// Default reminder schedule applied to real lease envelopes.
// DocuSign's "notification" object on the envelope: nag after N days
// of no action, repeat every M days, expire after X days.
const DEFAULT_NOTIFICATION = () => {
  const n = new docusign.Notification();
  n.useAccountDefaults = 'false';
  n.reminders = new docusign.Reminders();
  n.reminders.reminderEnabled = 'true';
  n.reminders.reminderDelay = '3';     // first nudge 3 days after send
  n.reminders.reminderFrequency = '2'; // every 2 days thereafter
  n.expirations = new docusign.Expirations();
  n.expirations.expireEnabled = 'true';
  n.expirations.expireAfter = '30';    // void if unsigned after 30 days
  n.expirations.expireWarn = '5';      // warn signer 5 days before
  return n;
};

// DocuSign error shape:
//   err.response.body = { errorCode, message, ... }  (object)
//   err.response.text = '<raw JSON string>'          (string)
//   err.response.statusCode = <HTTP status>          (number)
// Normalise into one consistent Error with the diagnostic fields
// (.code, .statusCode, .upstream, .sdkMessage) that logErr expects.
const wrapDocusignError = (err, op) => {
  let body = err?.response?.body || null;
  if (!body && err?.response?.text) {
    try { body = JSON.parse(err.response.text); } catch { body = err.response.text; }
  }
  const statusCode = err?.response?.statusCode ?? err?.response?.status ?? null;
  const code = (body && typeof body === 'object' && body.errorCode) || null;
  const detail = (body && typeof body === 'object' && body.message) || err?.message || 'unknown';
  const e = new Error(`DocuSign ${op} failed: ${detail}`);
  e.code = code;
  e.statusCode = statusCode;
  e.upstream = body;
  e.sdkMessage = err?.message || null;
  return e;
};

// ----- send: free-form PDF with anchor tabs ------------------
// Accepts either pdfBuffer (preferred — Render's filesystem is
// ephemeral) or pdfPath (loaded from disk). Caller picks one.
//
// LEGAL NOTE (SA ECT Act, Act 25 of 2002):
//   DocuSign standard electronic signatures satisfy section 13(3)
//   of the ECT Act for ordinary lease agreements (residential and
//   commercial), addendums, renewals, and most general commercial
//   contracts. The Act accepts "advanced electronic signatures"
//   (AES) — issued by an accredited authentication service provider
//   under section 37 — for a narrower set of documents that the
//   Act lists in Schedule 1 (and any others the Minister adds).
//   In practice, AES is mandatory for:
//     • alienation of land / property transfer deeds (Alienation
//       of Land Act, 1981 — sale agreements for immovable property
//       must be signed, and case law has historically required
//       wet ink or AES)
//     • wills and testamentary instruments (Wills Act, 1953)
//     • certain suretyship agreements (General Law Amendment Act,
//       1956, where the deed must be signed by both parties)
//     • bills of exchange and long-term immovable-property leases
//       registered against title deeds
//   This sendLease* path uses ordinary DocuSign signatures and is
//   FINE for monthly/yearly rental leases. It MUST NOT be used as
//   the sole signing mechanism for any of the bullets above. If
//   property transfer deeds are added later, route them through
//   an AES-issuing provider, not this code path.
//   This is a documentation comment only — there is no runtime
//   check, since the document type isn't visible to us here.
// Build the per-signer Tabs object from a role. Returns a docusign.Tabs
// populated with all four anchor types — SignHere, DateSigned, FullName,
// InitialHere — pointing at the role-prefixed anchor strings.
const tabsForRole = (role) => {
  const a = anchorsFor(role);
  const sig = new docusign.SignHere();
  sig.anchorString = a.sig;
  sig.anchorUnits = 'pixels';
  sig.anchorXOffset = '0';
  sig.anchorYOffset = '0';
  const date = new docusign.DateSigned();
  date.anchorString = a.date;
  date.anchorUnits = 'pixels';
  date.anchorXOffset = '0';
  date.anchorYOffset = '0';
  const name = new docusign.FullName();
  name.anchorString = a.name;
  name.anchorUnits = 'pixels';
  name.anchorXOffset = '0';
  name.anchorYOffset = '0';
  const initial = new docusign.InitialHere();
  initial.anchorString = a.init;
  initial.anchorUnits = 'pixels';
  initial.anchorXOffset = '0';
  initial.anchorYOffset = '0';
  const tabs = new docusign.Tabs();
  tabs.signHereTabs = [sig];
  tabs.dateSignedTabs = [date];
  tabs.fullNameTabs = [name];
  tabs.initialHereTabs = [initial];
  return tabs;
};

// signers: [{ name, email, role: 'landlord'|'tenant'|'surety'|'witness',
//             routingOrder?: number }]
// At least one signer required. routingOrder defaults to position+1
// in array order. Anchors derived from role.
//
// enableReminders: if true (default), set the DocuSign envelope's
// notification block so DocuSign emails nags at days 3, 5, 7, ...
// and expires the envelope after 30 days of inactivity. Disable for
// test envelopes so we don't spam reviewers.
export const sendLeaseForSignature = async ({
  signers,
  pdfBuffer,
  pdfPath,
  emailSubject,
  documentName = 'Lease Agreement',
  enableReminders = true,
}) => {
  if (!Array.isArray(signers) || signers.length === 0) {
    throw new Error('signers[] is required (at least one signer)');
  }
  signers.forEach((s, i) => {
    if (!s || !s.name || !s.email || !s.role) {
      throw new Error(`signers[${i}] requires name, email, role`);
    }
    if (!ROLE_REGEX.test(s.role)) {
      throw new Error(`signers[${i}].role='${s.role}' must match landlord | tenant | surety[_<n>] | witness[_<n>]`);
    }
  });
  if (!pdfBuffer && !pdfPath) {
    throw new Error('Provide pdfBuffer (preferred) or pdfPath');
  }
  const buf = pdfBuffer
    ? Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer)
    : fs.readFileSync(pdfPath);

  const envDef = new docusign.EnvelopeDefinition();
  envDef.emailSubject = emailSubject || 'Please sign your lease agreement';
  envDef.status = 'sent';
  if (enableReminders) envDef.notification = DEFAULT_NOTIFICATION();

  const doc = new docusign.Document();
  doc.documentBase64 = buf.toString('base64');
  doc.name = documentName;
  doc.fileExtension = 'pdf';
  doc.documentId = '1';
  envDef.documents = [doc];

  envDef.recipients = new docusign.Recipients();
  envDef.recipients.signers = signers.map((s, i) => {
    const signer = new docusign.Signer();
    signer.name = s.name;
    signer.email = s.email;
    signer.recipientId = String(i + 1);
    signer.routingOrder = String(s.routingOrder ?? i + 1);
    signer.roleName = s.role; // useful in webhooks for downstream routing
    signer.tabs = tabsForRole(s.role);
    return signer;
  });

  try {
    const { apiClient, accountId } = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    const results = await envelopesApi.createEnvelope(accountId, { envelopeDefinition: envDef });
    return { envelopeId: results.envelopeId, status: results.status, uri: results.uri };
  } catch (err) {
    throw wrapDocusignError(err, 'createEnvelope');
  }
};

// ----- send: from a reusable template ------------------------
export const sendLeaseFromTemplate = async ({
  templateId,
  signerName,
  signerEmail,
  roleName,
  emailSubject,
}) => {
  if (!templateId) throw new Error('templateId is required');
  if (!signerName || !signerEmail) throw new Error('signerName and signerEmail are required');
  if (!roleName) throw new Error('roleName is required (must match the role in the DocuSign template)');

  const envDef = new docusign.EnvelopeDefinition();
  envDef.templateId = templateId;
  envDef.emailSubject = emailSubject || 'Please sign your lease agreement';
  envDef.status = 'sent';

  const role = new docusign.TemplateRole();
  role.email = signerEmail;
  role.name = signerName;
  role.roleName = roleName;

  envDef.templateRoles = [role];

  try {
    const { apiClient, accountId } = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    const results = await envelopesApi.createEnvelope(accountId, { envelopeDefinition: envDef });
    return { envelopeId: results.envelopeId, status: results.status, uri: results.uri };
  } catch (err) {
    throw wrapDocusignError(err, 'createEnvelope (template)');
  }
};

// ----- read: envelope status ---------------------------------
export const getEnvelopeStatus = async (envelopeId) => {
  if (!envelopeId) throw new Error('envelopeId is required');
  try {
    const { apiClient, accountId } = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    return await envelopesApi.getEnvelope(accountId, envelopeId);
  } catch (err) {
    throw wrapDocusignError(err, 'getEnvelope');
  }
};

// ----- read: download signed PDF -----------------------------
// documentId='combined' returns all docs + cert merged; '1' etc.
// returns a single document. Result is a Buffer either way.
export const downloadSignedDocument = async (envelopeId, documentId = 'combined') => {
  if (!envelopeId) throw new Error('envelopeId is required');
  try {
    const { apiClient, accountId } = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    // The SDK returns a Buffer for binary endpoints in Node.
    const result = await envelopesApi.getDocument(accountId, envelopeId, String(documentId));
    return Buffer.isBuffer(result) ? result : Buffer.from(result);
  } catch (err) {
    throw wrapDocusignError(err, 'getDocument');
  }
};

// ----- read: list envelopes (admin views) --------------------
export const listEnvelopes = async ({ fromDate } = {}) => {
  if (!fromDate) {
    // Default to last 30 days if caller didn't specify.
    fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  try {
    const { apiClient, accountId } = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    const results = await envelopesApi.listStatusChanges(accountId, { fromDate });
    return results;
  } catch (err) {
    throw wrapDocusignError(err, 'listStatusChanges');
  }
};

// ----- read: list recipients on a single envelope ------------
// Returns the full recipient block (signers, carbonCopies, etc.)
// with their current statuses (created/sent/delivered/completed/
// declined/...). Useful for showing per-recipient progress in
// admin UI and for Go-Live API variety.
export const listRecipients = async (envelopeId) => {
  if (!envelopeId) throw new Error('envelopeId is required');
  try {
    const { apiClient, accountId } = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    return await envelopesApi.listRecipients(accountId, envelopeId);
  } catch (err) {
    throw wrapDocusignError(err, 'listRecipients');
  }
};

// ----- mutate: resend signing emails + (re)enable reminders --
// "Resend" in DocuSign is implemented as PUT /recipients with the
// query flag resend_envelope=true: it re-sends the signing email to
// every recipient on the envelope whose status isn't 'completed'.
// We also flip the envelope's notification block on to re-enable the
// reminder cadence in case it was disabled previously (or the
// envelope was created before we set defaults).
export const resendEnvelope = async (envelopeId) => {
  if (!envelopeId) throw new Error('envelopeId is required');
  try {
    const { apiClient, accountId } = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    // 1. Fetch current recipients, find the ones still pending.
    const recipients = await envelopesApi.listRecipients(accountId, envelopeId);
    const signers = Array.isArray(recipients?.signers) ? recipients.signers : [];
    const pending = signers.filter(s => s.status !== 'completed' && s.status !== 'declined');
    if (pending.length === 0) {
      return { ok: true, resent: 0, note: 'no pending signers' };
    }

    // 2. Re-trigger signing emails via updateRecipients?resend_envelope=true.
    //    Pass through the existing signer rows so DocuSign doesn't replace
    //    the recipient list — we're only flipping the resend flag.
    const updatePayload = new docusign.Recipients();
    updatePayload.signers = pending;
    await envelopesApi.updateRecipients(accountId, envelopeId, {
      recipients: updatePayload,
      resendEnvelope: 'true',
    });

    // 3. Make sure the envelope-level reminder schedule is on so
    //    DocuSign keeps nagging without further action from us.
    try {
      const env = new docusign.Envelope();
      env.notification = DEFAULT_NOTIFICATION();
      await envelopesApi.update(accountId, envelopeId, { envelope: env });
    } catch {
      // Notification update is best-effort; don't fail the resend over it.
    }

    return { ok: true, resent: pending.length, recipients: pending.map(s => s.email) };
  } catch (err) {
    throw wrapDocusignError(err, 'resendEnvelope');
  }
};

// ----- read: service account / config info -------------------
// Used by GET /api/docusign/status. Mints a JWT (which also runs
// /oauth/userinfo discovery) and returns just the metadata needed
// to render a status card in the SPA — no secrets.
export const getServiceAccountInfo = async () => {
  const { apiClient, accountId, basePath } = await getApiClient();
  // /oauth/userinfo via the SDK requires the access token already in
  // the apiClient's default headers (it is — getApiClient set it).
  let userInfo = null;
  try {
    userInfo = await apiClient.getUserInfo(
      apiClient.defaultHeaders.Authorization.replace(/^Bearer\s+/i, ''),
    );
  } catch {
    // Best-effort — base path was already discovered, status can
    // still render.
  }
  const account = (userInfo?.accounts || []).find(
    a => String(a.accountId) === String(accountId),
  ) || null;
  return {
    environment: isProduction() ? 'PRODUCTION' : 'DEMO',
    accountId,
    accountName: account?.accountName || null,
    apiUsername: userInfo?.email || null,
    baseUri: basePath,
  };
};

// ----- read: list documents within an envelope ---------------
// Distinct from getDocument (which downloads binary content):
// this returns metadata only — array of { documentId, name,
// type, order, ... } so a caller can decide which doc to fetch.
export const listEnvelopeDocuments = async (envelopeId) => {
  if (!envelopeId) throw new Error('envelopeId is required');
  try {
    const { apiClient, accountId } = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    return await envelopesApi.listDocuments(accountId, envelopeId);
  } catch (err) {
    throw wrapDocusignError(err, 'listDocuments');
  }
};
