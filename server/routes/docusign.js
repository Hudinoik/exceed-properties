// ============================================================
// Authenticated DocuSign management endpoints.
//
// These wrap the JWT-authed operations in server/docusign/.
// All routes require an active user session — only the
// /docusign/webhook receiver (registered in webhooks.js) is
// public, since DocuSign Connect can't carry our session cookie.
//
// Error responses are deliberately generic. DocuSign's nested
// error body is logged server-side via audit + console.error
// but never returned to the SPA, to avoid leaking integration
// internals.
// ============================================================
import express from 'express';
import { requireAuth } from './auth.js';
import {
  sendLeaseForSignature,
  sendLeaseFromTemplate,
  getEnvelopeStatus,
  downloadSignedDocument,
  listEnvelopes,
  listRecipients,
  listEnvelopeDocuments,
} from '../docusign/envelopes.js';
import { audit } from '../db.js';

const router = express.Router();
router.use(requireAuth);

const logErr = (op, err) => {
  // Use whatever logger the project standardised on. Today that's
  // raw console.error (same as the rest of server/*); switch here
  // if a real logger lands later.
  // eslint-disable-next-line no-console
  console.error(`[docusign] ${op} failed:`, err?.code || '', err?.message || err);
  if (err?.upstream) {
    // eslint-disable-next-line no-console
    console.error(`[docusign] ${op} upstream:`, err.upstream);
  }
};

// ----- POST /send-lease ---------------------------------------
// Body: { signerName, signerEmail, pdfBase64, emailSubject?, documentName? }
// We accept base64 over the wire because the SPA generates lease
// PDFs client-side (docxtemplater → PDF). Server decodes to Buffer.
router.post('/send-lease', async (req, res) => {
  const { signerName, signerEmail, pdfBase64, emailSubject, documentName } = req.body || {};
  if (!signerName || !signerEmail || !pdfBase64) {
    return res.status(400).json({ error: 'signerName, signerEmail and pdfBase64 are required' });
  }
  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(String(pdfBase64), 'base64');
  } catch {
    return res.status(400).json({ error: 'pdfBase64 is not valid base64' });
  }
  if (pdfBuffer.length === 0) {
    return res.status(400).json({ error: 'pdfBase64 decoded to zero bytes' });
  }
  try {
    const result = await sendLeaseForSignature({
      signerName, signerEmail, pdfBuffer, emailSubject, documentName,
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'docusign.send-lease',
      details: { envelopeId: result.envelopeId, signerEmail },
      ip: req.ip,
    });
    res.json({ ok: true, envelopeId: result.envelopeId, status: result.status });
  } catch (err) {
    logErr('send-lease', err);
    if (err.code === 'consent_required') {
      return res.status(503).json({ error: 'DocuSign consent required — see server logs.' });
    }
    res.status(502).json({ error: 'Failed to send envelope.' });
  }
});

// ----- POST /send-from-template -------------------------------
// Body: { templateId, signerName, signerEmail, roleName, emailSubject? }
router.post('/send-from-template', async (req, res) => {
  const { templateId, signerName, signerEmail, roleName, emailSubject } = req.body || {};
  if (!templateId || !signerName || !signerEmail || !roleName) {
    return res.status(400).json({ error: 'templateId, signerName, signerEmail and roleName are required' });
  }
  try {
    const result = await sendLeaseFromTemplate({
      templateId, signerName, signerEmail, roleName, emailSubject,
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'docusign.send-from-template',
      details: { envelopeId: result.envelopeId, templateId, signerEmail },
      ip: req.ip,
    });
    res.json({ ok: true, envelopeId: result.envelopeId, status: result.status });
  } catch (err) {
    logErr('send-from-template', err);
    if (err.code === 'consent_required') {
      return res.status(503).json({ error: 'DocuSign consent required — see server logs.' });
    }
    res.status(502).json({ error: 'Failed to send envelope.' });
  }
});

// ----- GET /envelopes ----------------------------------------
// Query: ?fromDate=ISO-8601 (default: 30 days ago)
// Lists envelopes whose status changed since `fromDate`. Used by
// admin views and by the Go-Live smoke test (counts as the
// listStatusChanges API method type).
router.get('/envelopes', async (req, res) => {
  const fromDate = req.query.fromDate ? String(req.query.fromDate) : undefined;
  try {
    const results = await listEnvelopes({ fromDate });
    res.json({ results });
  } catch (err) {
    logErr('list-envelopes', err);
    res.status(502).json({ error: 'Failed to list envelopes.' });
  }
});

// ----- GET /envelopes/:id -------------------------------------
router.get('/envelopes/:id', async (req, res) => {
  try {
    const envelope = await getEnvelopeStatus(req.params.id);
    res.json({ envelope });
  } catch (err) {
    logErr('get-envelope', err);
    res.status(502).json({ error: 'Failed to retrieve envelope.' });
  }
});

// ----- GET /envelopes/:id/recipients --------------------------
// Returns per-recipient status (created/sent/delivered/completed/
// declined). For admin per-tenant progress views.
router.get('/envelopes/:id/recipients', async (req, res) => {
  try {
    const recipients = await listRecipients(req.params.id);
    res.json({ recipients });
  } catch (err) {
    logErr('list-recipients', err);
    res.status(502).json({ error: 'Failed to list recipients.' });
  }
});

// ----- GET /envelopes/:id/documents ---------------------------
// Lists the documents in an envelope (metadata, not content).
// Combined with GET /envelopes/:id/document to download specific
// documents by ID.
router.get('/envelopes/:id/documents', async (req, res) => {
  try {
    const documents = await listEnvelopeDocuments(req.params.id);
    res.json({ documents });
  } catch (err) {
    logErr('list-documents', err);
    res.status(502).json({ error: 'Failed to list documents.' });
  }
});

// ----- GET /envelopes/:id/document ----------------------------
// Query: ?documentId=combined|1|2|... (default 'combined')
// Returns the binary PDF directly.
router.get('/envelopes/:id/document', async (req, res) => {
  const documentId = String(req.query.documentId || 'combined');
  try {
    const buf = await downloadSignedDocument(req.params.id, documentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="envelope-${req.params.id}-${documentId}.pdf"`);
    res.send(buf);
  } catch (err) {
    logErr('download-document', err);
    res.status(502).json({ error: 'Failed to download document.' });
  }
});

export default router;
