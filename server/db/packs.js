// ============================================================
// Lease pack data model + transition rules.
//
// A "pack" is one end-to-end lease workflow. It's the single source
// of truth for everything that happens between a tenant being
// offered a lease and that lease being loaded into Property Inspect
// at the end. Replaces the old `leases` localStorage array.
//
// Stages (canonical order):
//   offer_sent -> lease_drafting -> lease_checking -> docusign -> loading
//   (+ archived flag for completed packs and migrated active/expiring)
//
// Transitions are gated — see canTransition() below. Webhook-driven
// transitions (decline/void back to drafting) are allowed to skip
// the canonical ordering, marked with `viaWebhook: true`.
//
// Files (draft DOCX/PDF, signed PDF, FICA docs, application form)
// are stored INLINE as base64 inside the pack record. This avoids
// requiring a Render persistent disk. If pack count grows beyond
// what's comfortable for the lowdb JSON file (~50MB total file
// size), swap to disk storage via the storage helper.
// ============================================================
import { dbReady } from '../db.js';

// Canonical stage order. archived is a flag, not a position.
export const STAGES = ['offer_sent', 'lease_drafting', 'lease_checking', 'docusign', 'loading'];
export const STAGE_LABELS = {
  offer_sent:     'Offer Sent',
  lease_drafting: 'Lease Drafting',
  lease_checking: 'Lease Checking',
  docusign:       'DocuSign',
  loading:        'Loading',
};

// Cap the per-pack draft version history so the lowdb file doesn't
// grow unbounded. Older versions are dropped when a new draft saves.
const MAX_DRAFT_HISTORY = 10;

const now = () => new Date().toISOString();

// Pack ID format: pack_<unix-ms>_<6-base36>. Sortable, human-readable,
// collision-resistant across the volumes we care about.
const newPackId = () => {
  const ts = Date.now().toString();
  const rand = Math.random().toString(36).slice(2, 8).padStart(6, '0');
  return `pack_${ts}_${rand}`;
};

// Stage transition rules.
//   - User-driven (UI buttons) follows the canonical order forward
//     OR archive from loading.
//   - lease_checking can move BACK to lease_drafting (rejection).
//   - Webhook-driven (envelope-declined/voided) moves back to
//     lease_drafting regardless of current stage.
//   - Any stage can transition to "archived" only from loading via
//     the markLoaded path (separate function below) — direct stage
//     update to "archived" is rejected.
const ALLOWED_FORWARD = {
  offer_sent:     ['lease_drafting'],
  lease_drafting: ['lease_checking'],
  lease_checking: ['docusign', 'lease_drafting'], // checking can reject back to drafting
  docusign:       ['loading'],                    // forward path (envelope completed)
  loading:        [],                             // terminal — only markLoaded archives
};

// Webhook-driven transitions can bypass the forward-only rule.
// envelope-declined/voided drop straight to drafting from anywhere.
const WEBHOOK_BACK_TO_DRAFTING_FROM = ['docusign'];

export const canTransition = (fromStage, toStage, { viaWebhook = false } = {}) => {
  if (fromStage === toStage) return false; // no-op
  if (viaWebhook) {
    if (toStage === 'lease_drafting' && WEBHOOK_BACK_TO_DRAFTING_FROM.includes(fromStage)) {
      return true;
    }
    // Webhooks can also forward-move docusign → loading on completion
    // (the UI button does the same thing, but the webhook may race).
    if (toStage === 'loading' && fromStage === 'docusign') return true;
    return false;
  }
  return (ALLOWED_FORWARD[fromStage] || []).includes(toStage);
};

// Snapshot a transition into stageHistory so the audit trail is on
// the pack itself, not only in the global auditLog.
const appendStageHistory = (pack, { from, to, by, reason }) => {
  if (!Array.isArray(pack.stageHistory)) pack.stageHistory = [];
  pack.stageHistory.push({
    from: from || null,
    to,
    by: by || null,
    at: now(),
    reason: reason || null,
  });
};

// ----- CRUD ---------------------------------------------------

export const list = async ({ includeArchived = false } = {}) => {
  const db = await dbReady();
  const rows = Array.isArray(db.data.packs) ? db.data.packs : [];
  return rows
    .filter(p => includeArchived ? true : !p.archived)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
};

export const get = async (packId) => {
  const db = await dbReady();
  return (db.data.packs || []).find(p => p.packId === packId) || null;
};

export const create = async ({ pack, by }) => {
  const db = await dbReady();
  if (!Array.isArray(db.data.packs)) db.data.packs = [];

  const id = db.data.nextId.pack = (db.data.nextId.pack || 1) + 1;
  const packId = pack.packId || newPackId();

  const row = {
    id, packId,
    packType: pack.packType || 'new',
    tenantCode: pack.tenantCode || '',
    tenantName: pack.tenantName || '',
    tenantEmail: pack.tenantEmail || '',
    property: pack.property || '',
    unit: pack.unit || '',
    propertyId: pack.propertyId || null,
    unitId: pack.unitId || null,
    monthlyRent: Number(pack.monthlyRent) || 0,
    depositAmount: Number(pack.depositAmount) || 0,
    leaseTerm: Number(pack.leaseTerm) || 0,
    leaseStartDate: pack.leaseStartDate || null,
    stage: pack.stage && STAGES.includes(pack.stage) ? pack.stage : 'offer_sent',
    assignedAgent: pack.assignedAgent ?? null,
    archived: !!pack.archived,
    archivedAt: pack.archived ? (pack.archivedAt || now()) : null,
    // Optional document slots — populated as the workflow advances.
    ficaDocuments: Array.isArray(pack.ficaDocuments) ? pack.ficaDocuments : [],
    applicationForm: pack.applicationForm || null,
    draftedLease: null,
    draftedLeaseHistory: [],
    // DocuSign-related fields. Set when the pack reaches docusign stage.
    envelopeId: null,
    envelopeSentAt: null,
    envelopeStatus: null,
    signedPdfFileKey: null,
    // Loading stage.
    propertyInspectLoadedAt: null,
    propertyInspectRef: null,
    // Workflow metadata.
    comments: [],
    stageHistory: [],
    createdAt: now(),
    updatedAt: now(),
  };
  appendStageHistory(row, { from: null, to: row.stage, by, reason: pack.creationReason || 'created' });
  db.data.packs.push(row);
  await db.write();
  return row;
};

// Update arbitrary pack fields. Stage transitions go through transition()
// instead so the rules apply — this is for the non-stage fields.
export const update = async (packId, patch) => {
  const db = await dbReady();
  const row = (db.data.packs || []).find(p => p.packId === packId);
  if (!row) throw new Error(`Pack not found: ${packId}`);
  // Disallow stage / archived flips here — those have dedicated paths.
  const { stage: _drop1, archived: _drop2, archivedAt: _drop3, ...safePatch } = patch || {};
  Object.assign(row, safePatch);
  row.updatedAt = now();
  await db.write();
  return row;
};

export const transition = async (packId, toStage, { by, reason, viaWebhook = false } = {}) => {
  const db = await dbReady();
  const row = (db.data.packs || []).find(p => p.packId === packId);
  if (!row) throw new Error(`Pack not found: ${packId}`);
  if (!STAGES.includes(toStage)) {
    throw new Error(`Invalid target stage: ${toStage}`);
  }
  if (!canTransition(row.stage, toStage, { viaWebhook })) {
    const e = new Error(`Illegal transition: ${row.stage} -> ${toStage}` + (viaWebhook ? ' (via webhook)' : ''));
    e.code = 'illegal_transition';
    throw e;
  }
  const from = row.stage;
  row.stage = toStage;
  row.updatedAt = now();
  appendStageHistory(row, { from, to: toStage, by, reason });
  await db.write();
  return row;
};

// Save a new draft version. Updates the canonical draftedLease pointer
// AND appends to draftedLeaseHistory (oldest pruned at MAX_DRAFT_HISTORY).
// Files are passed as base64 strings; we don't write to disk.
export const saveDraft = async (packId, { docxBase64, pdfBase64, by }) => {
  const db = await dbReady();
  const row = (db.data.packs || []).find(p => p.packId === packId);
  if (!row) throw new Error(`Pack not found: ${packId}`);
  if (!docxBase64 || !pdfBase64) {
    throw new Error('saveDraft requires both docxBase64 and pdfBase64');
  }
  const version = (row.draftedLeaseHistory?.length || 0) + 1;
  const entry = {
    version,
    docxBase64,
    pdfBase64,
    docxSize: Math.floor(docxBase64.length * 3 / 4),
    pdfSize: Math.floor(pdfBase64.length * 3 / 4),
    draftedAt: now(),
    draftedBy: by || null,
  };
  if (!Array.isArray(row.draftedLeaseHistory)) row.draftedLeaseHistory = [];
  row.draftedLeaseHistory.push(entry);
  // Prune oldest to bound the lowdb file size.
  if (row.draftedLeaseHistory.length > MAX_DRAFT_HISTORY) {
    row.draftedLeaseHistory = row.draftedLeaseHistory.slice(-MAX_DRAFT_HISTORY);
  }
  // draftedLease points at the newest version — without re-storing
  // the base64 (just metadata pointers).
  row.draftedLease = {
    version: entry.version,
    docxSize: entry.docxSize,
    pdfSize: entry.pdfSize,
    draftedAt: entry.draftedAt,
    draftedBy: entry.draftedBy,
  };
  row.updatedAt = now();
  await db.write();
  return row;
};

// Append a comment to the pack thread. type: 'user' or 'system'.
// System comments record automatic actions (webhook-driven transitions,
// resend reminders, etc.) so the human reader can see the full story.
export const addComment = async (packId, { authorId, body, type = 'user' }) => {
  const db = await dbReady();
  const row = (db.data.packs || []).find(p => p.packId === packId);
  if (!row) throw new Error(`Pack not found: ${packId}`);
  if (!body || !String(body).trim()) {
    throw new Error('Comment body required');
  }
  if (!['user', 'system'].includes(type)) {
    throw new Error(`Invalid comment type: ${type}`);
  }
  if (!Array.isArray(row.comments)) row.comments = [];
  const comment = {
    id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    authorId: authorId ?? null,
    body: String(body).trim(),
    type,
    createdAt: now(),
  };
  row.comments.push(comment);
  row.updatedAt = now();
  await db.write();
  return comment;
};

// Set envelope fields when DocuSign send returns successfully.
export const setEnvelope = async (packId, { envelopeId, envelopeStatus }) => {
  const db = await dbReady();
  const row = (db.data.packs || []).find(p => p.packId === packId);
  if (!row) throw new Error(`Pack not found: ${packId}`);
  row.envelopeId = envelopeId;
  row.envelopeStatus = envelopeStatus || 'sent';
  row.envelopeSentAt = now();
  row.updatedAt = now();
  await db.write();
  return row;
};

// Update envelope status from a webhook event. May also store the
// signed PDF blob when the envelope completes.
export const updateEnvelopeStatus = async (envelopeId, { status, signedPdfBase64, reason } = {}) => {
  const db = await dbReady();
  const row = (db.data.packs || []).find(p => p.envelopeId === envelopeId);
  if (!row) return null; // No matching pack — webhook for an unknown envelope; caller decides what to do.
  row.envelopeStatus = status;
  row.updatedAt = now();
  if (signedPdfBase64) {
    row.signedPdfFileKey = `signed_v1`;
    row.signedPdfBase64 = signedPdfBase64;
    row.signedPdfAt = now();
  }
  if (reason) {
    // System comments are appended directly (no db.write inside addComment
    // because we're already holding the db write below).
    if (!Array.isArray(row.comments)) row.comments = [];
    row.comments.push({
      id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      authorId: null,
      body: reason,
      type: 'system',
      createdAt: now(),
    });
  }
  await db.write();
  return row;
};

// Mark a pack as loaded into Property Inspect. Terminal step in the
// pipeline. Sets loadedAt + optional reference + flips archived=true.
export const markLoaded = async (packId, { propertyInspectRef, by } = {}) => {
  const db = await dbReady();
  const row = (db.data.packs || []).find(p => p.packId === packId);
  if (!row) throw new Error(`Pack not found: ${packId}`);
  if (row.stage !== 'loading') {
    const e = new Error(`Can only mark-loaded from loading stage (currently ${row.stage})`);
    e.code = 'illegal_transition';
    throw e;
  }
  row.propertyInspectLoadedAt = now();
  row.propertyInspectRef = propertyInspectRef || null;
  row.archived = true;
  row.archivedAt = now();
  row.updatedAt = now();
  appendStageHistory(row, {
    from: row.stage, to: row.stage, by,
    reason: `marked loaded into Property Inspect${propertyInspectRef ? ` (ref ${propertyInspectRef})` : ''}`,
  });
  await db.write();
  return row;
};

// Read a draft PDF (or DOCX) at the given version. Returns the
// base64 string or null if the pack/version doesn't exist.
export const readDraftFile = async (packId, { version, format = 'pdf' } = {}) => {
  const row = await get(packId);
  if (!row) return null;
  const history = Array.isArray(row.draftedLeaseHistory) ? row.draftedLeaseHistory : [];
  const entry = version ? history.find(e => e.version === Number(version)) : history[history.length - 1];
  if (!entry) return null;
  return format === 'docx' ? entry.docxBase64 : entry.pdfBase64;
};

// Read the signed PDF (post envelope-completed webhook).
export const readSignedPdf = async (packId) => {
  const row = await get(packId);
  return row?.signedPdfBase64 || null;
};
