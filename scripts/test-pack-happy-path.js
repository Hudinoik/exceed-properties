// ============================================================
// Integration test: happy-path pack workflow end-to-end.
//
// Walks a pack from creation through every stage to "loaded into
// Property Inspect", simulating each transition the user would
// trigger from the UI + the envelope-completed webhook that the
// real DocuSign Connect listener would fire. No real DocuSign
// calls -- envelope IDs are fabricated to keep the test offline.
//
// Run with:  node scripts/test-pack-happy-path.js
// Exit 0 on pass, 1 on fail.
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-pack-happy-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'app.json');

const log = (...args) => console.log('[test]', ...args); // eslint-disable-line no-console
let failed = 0;
const assert = (cond, msg) => {
  if (cond) { log('PASS:', msg); }
  else { console.error('[test] FAIL:', msg); failed += 1; } // eslint-disable-line no-console
};

const { dbReady } = await import('../server/db.js');
const packs = await import('../server/db/packs.js');
await dbReady();

// 1. Create the pack.
const created = await packs.create({
  pack: {
    tenantName: 'Acme Corporation',
    tenantEmail: 'leasing@acme.test',
    tenantCode: 'ACME-001',
    property: 'Bougainville Shopping Centre',
    unit: 'Shop 7',
    monthlyRent: 32500,
    depositAmount: 65000,
    leaseTerm: 36,
    leaseStartDate: '2026-07-01',
  },
  by: 1,
});
assert(created.stage === 'offer_sent', 'created at offer_sent');
assert(created.packId.startsWith('pack_'), 'packId has expected prefix');

// 2. Start drafting.
await packs.transition(created.packId, 'lease_drafting', { by: 1 });

// 3. Save a draft (DOCX-only, mirrors the SPA drafter's output).
const fakeDocx = Buffer.from('PK\x03\x04 fake docx contents').toString('base64');
const draftSaved = await packs.saveDraft(created.packId, { docxBase64: fakeDocx, by: 1 });
assert(draftSaved.draftedLease && draftSaved.draftedLease.version === 1,
  'first draft has version 1');
assert(draftSaved.draftedLeaseHistory.length === 1, 'history length 1 after first save');

// 4. Save another draft -- version should increment, history grow.
await packs.saveDraft(created.packId, { docxBase64: fakeDocx, by: 1 });
const after2 = await packs.get(created.packId);
assert(after2.draftedLease.version === 2 && after2.draftedLeaseHistory.length === 2,
  'second draft increments version + history');

// 5. Move to checking.
await packs.transition(created.packId, 'lease_checking', { by: 1, reason: 'draft complete' });

// 6. Send to DocuSign. We can't call the real send-lease endpoint in
//    a unit context (it'd hit DocuSign for real), so emulate the
//    bookkeeping the route does after a successful upstream send.
const fakeEnvelopeId = '00000000-0000-0000-0000-aaaaaaaaaaaa';
await packs.setEnvelope(created.packId, { envelopeId: fakeEnvelopeId, envelopeStatus: 'sent' });
await packs.transition(created.packId, 'docusign', { by: 1, reason: 'envelope sent' });
const sent = await packs.get(created.packId);
assert(sent.stage === 'docusign', 'pack at docusign stage');
assert(sent.envelopeId === fakeEnvelopeId, 'envelopeId stored on pack');
assert(sent.envelopeStatus === 'sent', 'envelope status = sent');

// 7. Simulate envelope-completed webhook.
const fakeSignedPdf = Buffer.from('PDF FAKE signed bytes').toString('base64');
await packs.updateEnvelopeStatus(fakeEnvelopeId, {
  status: 'completed',
  signedPdfBase64: fakeSignedPdf,
  reason: 'Envelope completed -- all signers signed',
});
const completed = await packs.get(created.packId);
assert(completed.envelopeStatus === 'completed', 'status = completed after webhook');
assert(!!completed.signedPdfBase64, 'signed PDF stored on pack');
assert(completed.comments.some(c => c.type === 'system' && /completed/i.test(c.body)),
  'system comment added on completion');

// 8. User moves to Loading.
await packs.transition(created.packId, 'loading', { by: 1 });
const inLoading = await packs.get(created.packId);
assert(inLoading.stage === 'loading', 'reached loading stage');

// 9. Mark loaded.
const finalPack = await packs.markLoaded(created.packId, { propertyInspectRef: 'PI-HAPPY-001', by: 1 });
assert(finalPack.archived === true, 'archived after mark-loaded');
assert(finalPack.propertyInspectLoadedAt && finalPack.propertyInspectRef === 'PI-HAPPY-001',
  'PI fields set');
// Stage stays loading -- archived is the flag, not the stage.
assert(finalPack.stage === 'loading', 'stage stays at loading after mark-loaded');

// 10. Final accounting: stageHistory should record every transition.
//     Created (offer_sent) + 5 user transitions + 1 reject-test (none here) + markLoaded entry.
//     created -> drafting -> checking -> docusign -> loading + markLoaded snapshot = 6.
assert(finalPack.stageHistory.length >= 5, `stageHistory has at least 5 entries (got ${finalPack.stageHistory.length})`);

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }

if (failed === 0) {
  console.log('\n[test] HAPPY PATH PASS\n'); // eslint-disable-line no-console
  process.exit(0);
}
console.error(`\n[test] FAILED ${failed} assertion(s)\n`); // eslint-disable-line no-console
process.exit(1);
