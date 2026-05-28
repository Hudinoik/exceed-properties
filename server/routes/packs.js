// ============================================================
// Lease pack REST routes.
//
// All endpoints require an active session (requireAuth middleware).
// Mounted at /api/packs in server.js. Stage transitions go through
// the dedicated patch routes so the server-side rules apply -- raw
// PATCH /api/packs/:id with { stage: '...' } in the body is
// REJECTED to avoid bypassing the transition matrix.
//
// File payloads (lease DOCX/PDF) move in/out of pack records as
// base64. The body limit on these endpoints is 20MB (the same as
// the global express.json limit) which comfortably covers a real
// lease + a couple of FICA scans.
// ============================================================
import express from 'express';
import { requireAuth } from './auth.js';
import { audit } from '../db.js';
import * as packs from '../db/packs.js';

const router = express.Router();
router.use(requireAuth);

// Strip large base64 blobs before sending list/get responses to the
// client. The SPA fetches the file content via dedicated /files/*
// endpoints; the list view never needs the raw bytes. Keeps responses
// small (a single pack with 10 drafts at 1MB each would be 10MB
// otherwise; a pipeline view of 50 packs makes that 500MB).
const strip = (pack) => {
  if (!pack) return pack;
  const { signedPdfBase64, draftedLeaseHistory, documents, ...rest } = pack;
  // Replace each doc slot with metadata only — the SPA fetches the file
  // bytes separately via /files/document-:slot when the user downloads.
  let stripDocs = null;
  if (documents && typeof documents === 'object') {
    stripDocs = {};
    for (const [k, v] of Object.entries(documents)) {
      stripDocs[k] = v ? {
        name: v.name, contentType: v.contentType, size: v.size,
        uploadedAt: v.uploadedAt, uploadedBy: v.uploadedBy,
      } : null;
    }
  }
  return {
    ...rest,
    documents: stripDocs,
    // History entries keep their metadata, drop the bytes.
    draftedLeaseHistory: Array.isArray(draftedLeaseHistory)
      ? draftedLeaseHistory.map(({ docxBase64: _d, pdfBase64: _p, leaseOnlyDocxBase64: _l, annexuresOnlyDocxBase64: _a, ...meta }) => ({
          ...meta,
          hasLeaseOnly: !!_l,
          hasAnnexures: !!_a,
        }))
      : [],
    signedPdfAvailable: !!signedPdfBase64,
  };
};

// ----- GET /api/packs ----------------------------------------
// Query:
//   ?archived=1   include archived packs (default: false)
router.get('/', async (req, res) => {
  try {
    const includeArchived = req.query.archived === '1' || req.query.archived === 'true';
    const rows = await packs.list({ includeArchived });
    res.json({ packs: rows.map(strip) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[packs] list failed:', err.message);
    res.status(500).json({ error: 'Failed to list packs' });
  }
});

// ----- GET /api/packs/:packId --------------------------------
router.get('/:packId', async (req, res) => {
  try {
    const pack = await packs.get(req.params.packId);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });
    res.json({ pack: strip(pack) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[packs] get failed:', err.message);
    res.status(500).json({ error: 'Failed to retrieve pack' });
  }
});

// ----- POST /api/packs ---------------------------------------
// Body: full pack fields (see server/db/packs.js create). Required:
// tenantName at minimum. Everything else can be filled in later.
router.post('/', async (req, res) => {
  const body = req.body || {};
  if (!body.tenantName) {
    return res.status(400).json({ error: 'tenantName is required' });
  }
  try {
    const created = await packs.create({ pack: body, by: req.session.userId });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.create',
      details: { packId: created.packId, stage: created.stage, tenantName: created.tenantName },
      ip: req.ip,
    });
    res.status(201).json({ pack: strip(created) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[packs] create failed:', err.message);
    res.status(500).json({ error: 'Failed to create pack' });
  }
});

// ----- PATCH /api/packs/:packId ------------------------------
// Body: a partial pack object. Stage transitions go through the
// dedicated /stage endpoint instead -- raw stage/archived patches
// here are rejected so the transition matrix applies.
router.patch('/:packId', async (req, res) => {
  const body = req.body || {};
  if ('stage' in body || 'archived' in body || 'archivedAt' in body) {
    return res.status(400).json({
      error: 'Use POST /api/packs/:packId/stage to change stage; archive happens via /mark-loaded',
    });
  }
  try {
    const updated = await packs.update(req.params.packId, body);
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.update',
      details: { packId: req.params.packId, fields: Object.keys(body) },
      ip: req.ip,
    });
    res.json({ pack: strip(updated) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[packs] update failed:', err.message);
    if (err.message.startsWith('Pack not found')) {
      return res.status(404).json({ error: 'Pack not found' });
    }
    res.status(500).json({ error: 'Failed to update pack' });
  }
});

// ----- POST /api/packs/:packId/stage -------------------------
// Body: { toStage, reason? } -- user-driven transitions only.
// Webhook-driven transitions go through the webhook handler directly.
router.post('/:packId/stage', async (req, res) => {
  const { toStage, reason } = req.body || {};
  if (!toStage) {
    return res.status(400).json({ error: 'toStage is required' });
  }
  try {
    const updated = await packs.transition(req.params.packId, toStage, {
      by: req.session.userId,
      reason: reason || null,
      viaWebhook: false,
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.transition',
      details: { packId: req.params.packId, toStage, reason: reason || null },
      ip: req.ip,
    });
    res.json({ pack: strip(updated) });
  } catch (err) {
    if (err.code === 'illegal_transition') {
      return res.status(409).json({ error: err.message });
    }
    if (err.code === 'missing_documents') {
      return res.status(409).json({ error: err.message, missing: err.missing });
    }
    if (err.message?.startsWith('Pack not found')) {
      return res.status(404).json({ error: 'Pack not found' });
    }
    // eslint-disable-next-line no-console
    console.error('[packs] transition failed:', err.message);
    res.status(500).json({ error: 'Failed to transition pack' });
  }
});

// ----- POST /api/packs/:packId/draft -------------------------
// Body: { docxBase64, pdfBase64 }
// Saves a new draft version. Does NOT advance the stage -- the
// caller does that via /stage in a separate request (this lets the
// drafter offer "Save Draft" vs "Save and Send to Checking" as
// distinct actions).
router.post('/:packId/draft', async (req, res) => {
  const { docxBase64, pdfBase64, leaseOnlyDocxBase64, annexuresOnlyDocxBase64 } = req.body || {};
  if (!docxBase64 && !pdfBase64) {
    return res.status(400).json({ error: 'At least one of docxBase64 or pdfBase64 is required' });
  }
  try {
    const updated = await packs.saveDraft(req.params.packId, {
      docxBase64, pdfBase64, leaseOnlyDocxBase64, annexuresOnlyDocxBase64, by: req.session.userId,
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.draft.saved',
      details: {
        packId: req.params.packId,
        version: updated.draftedLease?.version,
        docxSize: updated.draftedLease?.docxSize,
        pdfSize: updated.draftedLease?.pdfSize,
      },
      ip: req.ip,
    });
    res.json({ pack: strip(updated) });
  } catch (err) {
    if (err.message?.startsWith('Pack not found')) {
      return res.status(404).json({ error: 'Pack not found' });
    }
    // eslint-disable-next-line no-console
    console.error('[packs] draft save failed:', err.message);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// ----- POST /api/packs/:packId/send-to-docusign --------------
// Reads the latest pack draft PDF and POSTs to the internal
// DocuSign send-lease endpoint (or, in this monolith, calls
// the underlying function directly). Updates the pack on success.
//
// Per spec: signer is tenant only -- tenantName + tenantEmail.
// Multi-signer envelopes stay in the standalone drafter path.
router.post('/:packId/send-to-docusign', async (req, res) => {
  try {
    const pack = await packs.get(req.params.packId);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });
    if (pack.stage !== 'lease_checking') {
      return res.status(409).json({
        error: `Pack must be in lease_checking stage to send (currently ${pack.stage})`,
      });
    }
    if (!pack.tenantName || !pack.tenantEmail) {
      return res.status(400).json({ error: 'Pack is missing tenantName or tenantEmail' });
    }
    // Prefer PDF when both formats are present (DocuSign serves PDF
    // back to signers faster). Fall back to DOCX which DocuSign
    // accepts natively. Either way we end up with a document the
    // tenant can sign.
    let pdfBase64 = await packs.readDraftFile(pack.packId, { format: 'pdf' });
    let docxBase64 = null;
    let fileExtension = 'pdf';
    if (!pdfBase64) {
      docxBase64 = await packs.readDraftFile(pack.packId, { format: 'docx' });
      if (!docxBase64) {
        return res.status(400).json({ error: 'No saved draft on this pack (neither PDF nor DOCX)' });
      }
      fileExtension = 'docx';
    }

    // Lazy import so the DocuSign module isn't loaded by any other
    // route handler (and so a misconfigured DocuSign config doesn't
    // break pack CRUD).
    const { sendLeaseForSignature } = await import('../docusign/envelopes.js');
    let envelopeResult;
    try {
      envelopeResult = await sendLeaseForSignature({
        signers: [{
          name: pack.tenantName,
          email: pack.tenantEmail,
          role: 'tenant',
          routingOrder: 1,
        }],
        pdfBuffer: Buffer.from(pdfBase64 || docxBase64, 'base64'),
        emailSubject: `Lease Agreement for ${pack.property || 'Exceed Properties'} -- Please Sign`,
        documentName: `Lease - ${pack.tenantName}.${fileExtension}`,
        fileExtension,
        enableReminders: true,
      });
    } catch (sendErr) {
      // Surface the underlying DocuSign error code (set by the
      // envelopes module's wrapDocusignError) so the user knows
      // exactly what went wrong instead of seeing a generic 502.
      // eslint-disable-next-line no-console
      console.error('[packs] send-to-docusign upstream failed:',
        sendErr.code || '', sendErr.message,
        sendErr.upstream ? JSON.stringify(sendErr.upstream) : '');
      return res.status(502).json({
        error: sendErr.message || 'DocuSign send failed',
        code: sendErr.code || null,
      });
    }

    // Persist envelope IDs on the pack and advance to docusign stage.
    await packs.setEnvelope(pack.packId, {
      envelopeId: envelopeResult.envelopeId,
      envelopeStatus: envelopeResult.status || 'sent',
    });
    const advanced = await packs.transition(pack.packId, 'docusign', {
      by: req.session.userId,
      reason: `envelope ${envelopeResult.envelopeId} sent`,
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.docusign.sent',
      details: {
        packId: pack.packId,
        envelopeId: envelopeResult.envelopeId,
        signerEmail: pack.tenantEmail,
      },
      ip: req.ip,
    });
    res.json({ pack: strip(advanced), envelopeId: envelopeResult.envelopeId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[packs] send-to-docusign failed:', err.message);
    res.status(500).json({ error: 'Failed to send envelope' });
  }
});

// ----- POST /api/packs/:packId/resend-reminder ---------------
router.post('/:packId/resend-reminder', async (req, res) => {
  try {
    const pack = await packs.get(req.params.packId);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });
    if (!pack.envelopeId) {
      return res.status(400).json({ error: 'No envelope on this pack' });
    }
    const { resendEnvelope } = await import('../docusign/envelopes.js');
    const result = await resendEnvelope(pack.envelopeId);
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.docusign.reminder',
      details: { packId: pack.packId, envelopeId: pack.envelopeId, resent: result.resent },
      ip: req.ip,
    });
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[packs] resend-reminder failed:', err.code || '', err.message);
    res.status(502).json({ error: err.message || 'Failed to send reminder' });
  }
});

// ----- POST /api/packs/:packId/void-envelope -----------------
// Voids the DocuSign envelope and resets the pack to lease_drafting.
// User-driven (the webhook handler does its own thing on
// envelope-voided events from DocuSign).
router.post('/:packId/void-envelope', async (req, res) => {
  const { reason } = req.body || {};
  try {
    const pack = await packs.get(req.params.packId);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });
    if (!pack.envelopeId) {
      return res.status(400).json({ error: 'No envelope on this pack' });
    }
    // Void via the DocuSign SDK. Errors surface as 502.
    const { getApiClient } = await import('../docusign/auth.js');
    const docusign = await import('docusign-esign');
    const { apiClient, accountId } = await getApiClient();
    const envelopesApi = new docusign.default.EnvelopesApi(apiClient);
    const envUpdate = new docusign.default.Envelope();
    envUpdate.status = 'voided';
    envUpdate.voidedReason = String(reason || 'Voided from Exceed Props pipeline').slice(0, 200);
    await envelopesApi.update(accountId, pack.envelopeId, { envelope: envUpdate });

    // Update pack: envelopeStatus = voided, move back to drafting.
    await packs.updateEnvelopeStatus(pack.envelopeId, {
      status: 'voided',
      reason: `Envelope voided: ${reason || '(no reason given)'}`,
    });
    const updated = await packs.transition(pack.packId, 'lease_drafting', {
      by: req.session.userId,
      viaWebhook: true,    // user-initiated, but follows the same matrix entry
      reason: reason || 'voided by agent',
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.docusign.voided',
      details: { packId: pack.packId, envelopeId: pack.envelopeId, reason: reason || null },
      ip: req.ip,
    });
    res.json({ pack: strip(updated) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[packs] void-envelope failed:', err.code || '', err.message);
    res.status(502).json({ error: err.message || 'Failed to void envelope' });
  }
});

// ----- POST /api/packs/:packId/mark-loaded -------------------
// Body: { propertyInspectRef? }
// Terminal step. Pack stays at stage='loading' but archived flips
// to true so it falls off the pipeline view (visible via Show Archived).
router.post('/:packId/mark-loaded', async (req, res) => {
  const { propertyInspectRef } = req.body || {};
  try {
    const updated = await packs.markLoaded(req.params.packId, {
      propertyInspectRef: propertyInspectRef || null,
      by: req.session.userId,
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.loaded',
      details: { packId: req.params.packId, propertyInspectRef: propertyInspectRef || null },
      ip: req.ip,
    });
    res.json({ pack: strip(updated) });
  } catch (err) {
    if (err.code === 'illegal_transition') {
      return res.status(409).json({ error: err.message });
    }
    if (err.message?.startsWith('Pack not found')) {
      return res.status(404).json({ error: 'Pack not found' });
    }
    // eslint-disable-next-line no-console
    console.error('[packs] mark-loaded failed:', err.message);
    res.status(500).json({ error: 'Failed to mark loaded' });
  }
});

// ----- GET /api/packs/:packId/files/:fileType ----------------
// fileType:
//   draft-latest.pdf  -> latest draft PDF
//   draft-latest.docx -> latest draft DOCX
//   draft-N.pdf       -> specific version (1..N)
//   draft-N.docx
//   signed.pdf        -> post envelope-completed
router.get('/:packId/files/:fileType', async (req, res) => {
  const { packId, fileType } = req.params;
  try {
    let base64;
    let contentType;
    let downloadName;
    if (fileType === 'signed.pdf') {
      base64 = await packs.readSignedPdf(packId);
      contentType = 'application/pdf';
      downloadName = `${packId}-signed.pdf`;
    } else if (fileType.startsWith('document-')) {
      // FICA / application doc download. fileType = "document-<slot>".
      const slot = fileType.slice('document-'.length);
      const doc = await packs.readDocument(packId, slot);
      if (!doc) return res.status(404).json({ error: 'Document not uploaded' });
      base64 = doc.base64;
      contentType = doc.contentType || 'application/octet-stream';
      downloadName = doc.name || `${packId}-${slot}`;
    } else if (fileType === 'lease.docx' || fileType === 'annexures.docx') {
      // Standalone Part A (lease) and Part B (annexures: resolution +
      // surety) for the lease-checking view to print separately.
      const format = fileType === 'lease.docx' ? 'lease' : 'annexures';
      base64 = await packs.readDraftFile(packId, { format });
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      downloadName = `${packId}-${fileType}`;
    } else {
      const m = fileType.match(/^draft-(latest|\d+)\.(pdf|docx)$/);
      if (!m) return res.status(400).json({ error: 'Unknown file type' });
      const version = m[1] === 'latest' ? undefined : Number(m[1]);
      const format = m[2];
      base64 = await packs.readDraftFile(packId, { version, format });
      contentType = format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      downloadName = `${packId}-draft-${m[1]}.${format}`;
    }
    if (!base64) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.send(Buffer.from(base64, 'base64'));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[packs] file download failed:', err.message);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// ----- POST /api/packs/:packId/documents/:slot ---------------
// Body: { name, base64, contentType }
// Upload a FICA / application document to the named slot. The slot
// names are validated server-side (saveDocument throws on unknown
// slots). Pack must NOT already be past offer_sent to keep the file
// list aligned with what was used to authorise the draft.
router.post('/:packId/documents/:slot', async (req, res) => {
  const { packId, slot } = req.params;
  const { name, base64, contentType } = req.body || {};
  if (!base64) return res.status(400).json({ error: 'base64 is required' });
  try {
    const updated = await packs.saveDocument(packId, {
      slot, name, base64, contentType, by: req.session.userId,
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.document.upload',
      details: { packId, slot, name: name || null, size: updated.documents?.[slot]?.size || 0 },
      ip: req.ip,
    });
    res.json({ pack: strip(updated) });
  } catch (err) {
    if (err.message?.startsWith('Pack not found')) return res.status(404).json({ error: 'Pack not found' });
    if (err.message?.startsWith('Unknown document slot')) return res.status(400).json({ error: err.message });
    // eslint-disable-next-line no-console
    console.error('[packs] document upload failed:', err.message);
    res.status(500).json({ error: 'Failed to save document' });
  }
});
router.delete('/:packId/documents/:slot', async (req, res) => {
  const { packId, slot } = req.params;
  try {
    const updated = await packs.deleteDocument(packId, slot);
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.document.delete',
      details: { packId, slot },
      ip: req.ip,
    });
    res.json({ pack: strip(updated) });
  } catch (err) {
    if (err.message?.startsWith('Pack not found')) return res.status(404).json({ error: 'Pack not found' });
    if (err.message?.startsWith('Unknown document slot')) return res.status(400).json({ error: err.message });
    // eslint-disable-next-line no-console
    console.error('[packs] document delete failed:', err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ----- POST /api/packs/:packId/comments ----------------------
// Body: { body }
// User comments only -- system comments are emitted by the webhook
// handler and the pack module directly. type is forced to 'user'.
router.post('/:packId/comments', async (req, res) => {
  const { body } = req.body || {};
  if (!body || !String(body).trim()) {
    return res.status(400).json({ error: 'Comment body required' });
  }
  try {
    const comment = await packs.addComment(req.params.packId, {
      authorId: req.session.userId,
      body: String(body).trim(),
      type: 'user',
    });
    await audit.log({
      userId: req.session.userId, userEmail: req.session.email,
      action: 'pack.comment',
      details: { packId: req.params.packId, commentId: comment.id },
      ip: req.ip,
    });
    res.status(201).json({ comment });
  } catch (err) {
    if (err.message?.startsWith('Pack not found')) {
      return res.status(404).json({ error: 'Pack not found' });
    }
    // eslint-disable-next-line no-console
    console.error('[packs] add-comment failed:', err.message);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

export default router;
