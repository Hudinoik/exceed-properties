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
  resendEnvelope,
  getServiceAccountInfo,
} from '../docusign/envelopes.js';
import { envDiagnostics } from '../docusign/auth.js';
import { audit } from '../db.js';
// Lazy-loaded pdf-lib for the test-envelope endpoint — pulled in
// only when /test-envelope is hit, so the dep cost doesn't apply to
// real lease sends.
let _pdfLibCache;
const pdfLib = async () => {
  if (!_pdfLibCache) _pdfLibCache = await import('pdf-lib');
  return _pdfLibCache;
};

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
// Body: {
//   signers: [{ name, email, role: 'landlord'|'tenant'|..., routingOrder? }],
//   pdfBase64,
//   emailSubject?, documentName?
// }
// PDF is base64 over the wire — the SPA generates lease DOCX +
// converts to PDF entirely client-side, then sends the bytes.
// Render's filesystem is ephemeral so we never use pdfPath.
router.post('/send-lease', async (req, res) => {
  const { signers, pdfBase64, emailSubject, documentName } = req.body || {};
  if (!Array.isArray(signers) || signers.length === 0) {
    return res.status(400).json({ error: 'signers[] is required (at least one signer)' });
  }
  if (!pdfBase64) {
    return res.status(400).json({ error: 'pdfBase64 is required' });
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
      signers, pdfBuffer, emailSubject, documentName, enableReminders: true,
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'docusign.send-lease',
      details: {
        envelopeId: result.envelopeId,
        signers: signers.map(s => ({ role: s.role, email: s.email })),
      },
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

// ----- GET /status --------------------------------------------
// Used by the Settings → DocuSign panel to render the green/red
// indicator. Tries to mint a JWT + hit /oauth/userinfo; if either
// fails, returns { configured: false, error }.
router.get('/status', async (req, res) => {
  try {
    const info = await getServiceAccountInfo();
    res.json({ configured: true, ...info });
  } catch (err) {
    logErr('status', err);
    // When status fails, include the env-var diagnostic snapshot
    // (presence/length, never values) so an admin can confirm from
    // the browser whether DOCUSIGN_PRIVATE_KEY et al. are actually
    // visible to the running process. Mirrors the boot-log summary.
    res.json({
      configured: false,
      error: err.code === 'consent_required'
        ? 'DocuSign consent required — see server logs for the consent URL.'
        : (err.code || err.message || 'Failed to reach DocuSign.'),
      envDiagnostics: envDiagnostics(),
    });
  }
});

// ----- POST /test-envelope ------------------------------------
// Body: { name, email }
// Generates a one-page test PDF in-memory containing the tenant
// anchor strings, sends it without reminders, returns the envelope
// ID. Lets an admin verify the integration end-to-end from Settings.
router.post('/test-envelope', async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  try {
    const { PDFDocument, StandardFonts, rgb } = await pdfLib();
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Exceed Props — DocuSign Test Envelope', {
      x: 50, y: 720, size: 16, font, color: rgb(0, 0, 0),
    });
    page.drawText(`Generated ${new Date().toISOString()}`, {
      x: 50, y: 695, size: 10, font, color: rgb(0.3, 0.3, 0.3),
    });
    page.drawText('This is an integration test from Settings → DocuSign.', {
      x: 50, y: 660, size: 11, font,
    });
    page.drawText('Signature:', { x: 50, y: 540, size: 11, font });
    // White-on-white size-1 anchors so DocuSign locates them but
    // they don't render visibly.
    page.drawText('\\sig_tenant\\', {
      x: 50, y: 520, size: 1, font, color: rgb(1, 1, 1),
    });
    page.drawText('Date:', { x: 50, y: 500, size: 11, font });
    page.drawText('\\date_tenant\\', {
      x: 50, y: 480, size: 1, font, color: rgb(1, 1, 1),
    });
    const pdfBuffer = Buffer.from(await pdf.save());

    const result = await sendLeaseForSignature({
      signers: [{ name, email, role: 'tenant' }],
      pdfBuffer,
      emailSubject: 'Exceed Props — DocuSign test envelope',
      documentName: 'Test Envelope',
      enableReminders: false,
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'docusign.test-envelope',
      details: { envelopeId: result.envelopeId, recipient: email },
      ip: req.ip,
    });
    res.json({ ok: true, envelopeId: result.envelopeId, status: result.status });
  } catch (err) {
    logErr('test-envelope', err);
    if (err.code === 'consent_required') {
      return res.status(503).json({ error: 'DocuSign consent required — see server logs.' });
    }
    res.status(502).json({ error: 'Failed to send test envelope.' });
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

// ----- POST /envelopes/:id/remind -----------------------------
// Re-triggers the DocuSign signing email for any still-pending
// recipients and (re-)enables the envelope's reminder schedule.
// Idempotent — calling repeatedly just re-sends; DocuSign rate-
// limits if you abuse it.
router.post('/envelopes/:id/remind', async (req, res) => {
  try {
    const result = await resendEnvelope(req.params.id);
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'docusign.remind',
      details: { envelopeId: req.params.id, resent: result.resent },
      ip: req.ip,
    });
    res.json(result);
  } catch (err) {
    logErr('remind', err);
    res.status(502).json({ error: 'Failed to send reminder.' });
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
