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
import { getApiClient } from './auth.js';

// Anchor strings the lease PDF must contain (in white size-1 text
// so they don't show in the rendered document). See docs.
const ANCHOR_SIG = '/sig1/';
const ANCHOR_DATE = '/date1/';

// DocuSign error shape:
//   err.response.body = { errorCode, message, ... }  (object)
//   err.response.text = '<raw JSON string>'          (string)
// Normalise into one consistent Error.
const wrapDocusignError = (err, op) => {
  let body = err?.response?.body || null;
  if (!body && err?.response?.text) {
    try { body = JSON.parse(err.response.text); } catch { body = err.response.text; }
  }
  const code = (body && typeof body === 'object' && body.errorCode) || null;
  const detail = (body && typeof body === 'object' && body.message) || err?.message || 'unknown';
  const e = new Error(`DocuSign ${op} failed: ${detail}`);
  e.code = code;
  e.upstream = body;
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
export const sendLeaseForSignature = async ({
  signerName,
  signerEmail,
  pdfBuffer,
  pdfPath,
  emailSubject,
  documentName = 'Lease Agreement',
}) => {
  if (!signerName || !signerEmail) {
    throw new Error('signerName and signerEmail are required');
  }
  if (!pdfBuffer && !pdfPath) {
    throw new Error('Provide pdfBuffer (preferred) or pdfPath');
  }
  const buf = pdfBuffer
    ? Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer)
    : fs.readFileSync(pdfPath);

  const envDef = new docusign.EnvelopeDefinition();
  envDef.emailSubject = emailSubject || 'Please sign your lease agreement';
  envDef.status = 'sent';

  const doc = new docusign.Document();
  doc.documentBase64 = buf.toString('base64');
  doc.name = documentName;
  doc.fileExtension = 'pdf';
  doc.documentId = '1';
  envDef.documents = [doc];

  const signer = new docusign.Signer();
  signer.email = signerEmail;
  signer.name = signerName;
  signer.recipientId = '1';
  signer.routingOrder = '1';

  const signHere = new docusign.SignHere();
  signHere.anchorString = ANCHOR_SIG;
  signHere.anchorYOffset = '0';
  signHere.anchorUnits = 'pixels';
  signHere.anchorXOffset = '0';

  const dateSigned = new docusign.DateSigned();
  dateSigned.anchorString = ANCHOR_DATE;
  dateSigned.anchorYOffset = '0';
  dateSigned.anchorUnits = 'pixels';
  dateSigned.anchorXOffset = '0';

  signer.tabs = new docusign.Tabs();
  signer.tabs.signHereTabs = [signHere];
  signer.tabs.dateSignedTabs = [dateSigned];

  envDef.recipients = new docusign.Recipients();
  envDef.recipients.signers = [signer];

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
