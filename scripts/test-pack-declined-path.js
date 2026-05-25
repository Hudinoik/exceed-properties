// ============================================================
// Integration test: envelope-declined path.
//
// Pack reaches docusign, the tenant declines, the webhook handler
// (in production -- emulated here) updates the pack: status =
// declined + system comment + transition back to lease_drafting
// via the webhook bypass. Verifies the agent can then re-draft.
//
// Run with:  node scripts/test-pack-declined-path.js
// Exit 0 on pass, 1 on fail.
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-pack-decline-'));
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

// Drive a pack to docusign.
const pack = await packs.create({
  pack: {
    tenantName: 'Declining Tenant Ltd',
    tenantEmail: 'tenant@nope.test',
    tenantCode: 'DECLINE-001',
    monthlyRent: 18000,
    depositAmount: 36000,
    leaseTerm: 12,
  },
  by: 1,
});
await packs.transition(pack.packId, 'lease_drafting', { by: 1 });
await packs.saveDraft(pack.packId, { docxBase64: Buffer.from('docx bytes').toString('base64'), by: 1 });
await packs.transition(pack.packId, 'lease_checking', { by: 1 });
const fakeEnv = '00000000-0000-0000-0000-bbbbbbbbbbbb';
await packs.setEnvelope(pack.packId, { envelopeId: fakeEnv, envelopeStatus: 'sent' });
await packs.transition(pack.packId, 'docusign', { by: 1 });

const beforeDecline = await packs.get(pack.packId);
assert(beforeDecline.stage === 'docusign' && beforeDecline.envelopeStatus === 'sent',
  'pre-decline: pack is at docusign / sent');

// Simulate the envelope-declined webhook: update envelope status +
// transition back to drafting via the webhook bypass.
const declined = await packs.updateEnvelopeStatus(fakeEnv, {
  status: 'declined',
  reason: 'Envelope declined by signer. Pack returned to Lease Drafting.',
});
assert(declined && declined.envelopeStatus === 'declined',
  'updateEnvelopeStatus marks declined');
assert(declined.comments.some(c => c.type === 'system' && /declined/i.test(c.body)),
  'system comment recorded on decline');

await packs.transition(pack.packId, 'lease_drafting', { by: null, viaWebhook: true, reason: 'envelope-declined webhook' });
const back = await packs.get(pack.packId);
assert(back.stage === 'lease_drafting', 'pack moved back to lease_drafting via webhook bypass');

// Agent can save a NEW draft on top of the previous one -- version 2.
await packs.saveDraft(pack.packId, { docxBase64: Buffer.from('revised docx').toString('base64'), by: 1 });
const reDrafted = await packs.get(pack.packId);
assert(reDrafted.draftedLease.version === 2,
  `re-draft version is 2 (got ${reDrafted.draftedLease.version})`);
assert(reDrafted.draftedLeaseHistory.length === 2,
  'history retains both versions');

// Old envelopeId is still on the pack -- the agent could choose to
// void it from DocuSign or just leave it. The pack-side state machine
// doesn't auto-clear envelopeId on webhook-decline; that lives on the
// envelope-management surface.
assert(reDrafted.envelopeId === fakeEnv,
  'old envelopeId remains on pack post-decline (for traceability)');
assert(reDrafted.envelopeStatus === 'declined',
  'envelopeStatus still reads declined');

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }

if (failed === 0) {
  console.log('\n[test] DECLINED PATH PASS\n'); // eslint-disable-line no-console
  process.exit(0);
}
console.error(`\n[test] FAILED ${failed} assertion(s)\n`); // eslint-disable-line no-console
process.exit(1);
