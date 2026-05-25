// ============================================================
// Unit test for pack stage transition rules.
//
// Validates the transition matrix in server/db/packs.js. Catches
// regressions like:
//   - Skipping stages (offer_sent -> docusign should be illegal)
//   - User-driven webhook-only transitions (docusign -> lease_drafting
//     should be illegal without viaWebhook: true)
//   - Webhook bypass actually allowed
//   - markLoaded only from loading stage
//
// Same standalone-Node pattern as scripts/test-webhook-record.js.
// Run with:  node scripts/test-pack-transitions.js
// Exit 0 on pass, 1 on fail.
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated temp DB so we don't clobber real data.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-pack-trans-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'app.json');

const log = (...args) => console.log('[test]', ...args); // eslint-disable-line no-console
let failed = 0;
const assert = (cond, msg) => {
  if (cond) { log('PASS:', msg); }
  else { console.error('[test] FAIL:', msg); failed += 1; } // eslint-disable-line no-console
};
const assertThrows = async (fn, expectedCode, msg) => {
  try {
    await fn();
    console.error('[test] FAIL:', msg, '(no throw)'); // eslint-disable-line no-console
    failed += 1;
  } catch (err) {
    if (!expectedCode || err.code === expectedCode) {
      log('PASS:', msg, `(${err.code || 'thrown'})`);
    } else {
      console.error('[test] FAIL:', msg, `expected code=${expectedCode}, got code=${err.code}`); // eslint-disable-line no-console
      failed += 1;
    }
  }
};

const { dbReady } = await import('../server/db.js');
const packs = await import('../server/db/packs.js');
await dbReady();

// --- canTransition (pure function) -------------------------------
assert(packs.canTransition('offer_sent', 'lease_drafting') === true,
  'offer_sent -> lease_drafting allowed (user)');
assert(packs.canTransition('lease_drafting', 'lease_checking') === true,
  'lease_drafting -> lease_checking allowed (user)');
assert(packs.canTransition('lease_checking', 'docusign') === true,
  'lease_checking -> docusign allowed (user)');
assert(packs.canTransition('lease_checking', 'lease_drafting') === true,
  'lease_checking -> lease_drafting allowed (user reject)');
assert(packs.canTransition('docusign', 'loading') === true,
  'docusign -> loading allowed (user, on completion)');
assert(packs.canTransition('offer_sent', 'docusign') === false,
  'offer_sent -> docusign DISALLOWED (cant skip)');
assert(packs.canTransition('lease_drafting', 'docusign') === false,
  'lease_drafting -> docusign DISALLOWED (must go through checking)');
assert(packs.canTransition('docusign', 'lease_drafting') === false,
  'docusign -> lease_drafting DISALLOWED for user');
assert(packs.canTransition('docusign', 'lease_drafting', { viaWebhook: true }) === true,
  'docusign -> lease_drafting ALLOWED via webhook (decline/void)');
assert(packs.canTransition('loading', 'docusign') === false,
  'loading -> docusign DISALLOWED (terminal)');
assert(packs.canTransition('offer_sent', 'offer_sent') === false,
  'no-op same-stage transition DISALLOWED');

// --- transition() integration ------------------------------------
const p = await packs.create({
  pack: { tenantName: 'Test Co', tenantEmail: 't@test.com', tenantCode: 'TST-001' },
  by: 1,
});
assert(p.stage === 'offer_sent', 'created at offer_sent');

await packs.transition(p.packId, 'lease_drafting', { by: 1 });
let cur = await packs.get(p.packId);
assert(cur.stage === 'lease_drafting' && cur.stageHistory.length === 2,
  'transition advances stage + appends history');

await assertThrows(
  () => packs.transition(p.packId, 'docusign', { by: 1 }),
  'illegal_transition',
  'cannot skip lease_checking',
);
await assertThrows(
  () => packs.transition(p.packId, 'archived', { by: 1 }),
  null,
  'cannot transition to archived directly (not in STAGES)',
);

await packs.transition(p.packId, 'lease_checking', { by: 1 });
await packs.transition(p.packId, 'lease_drafting', { by: 1, reason: 'reject' });
cur = await packs.get(p.packId);
assert(cur.stage === 'lease_drafting', 'lease_checking -> lease_drafting (reject) allowed');

await packs.transition(p.packId, 'lease_checking', { by: 1 });
await packs.transition(p.packId, 'docusign', { by: 1 });
cur = await packs.get(p.packId);
assert(cur.stage === 'docusign', 'reached docusign via the matrix');

// Webhook bypass: decline pulls back to drafting from docusign
await packs.transition(p.packId, 'lease_drafting', { by: null, viaWebhook: true });
cur = await packs.get(p.packId);
assert(cur.stage === 'lease_drafting', 'docusign -> lease_drafting via webhook (decline path)');

// Step forward again to test markLoaded
await packs.transition(p.packId, 'lease_checking', { by: 1 });
await packs.transition(p.packId, 'docusign', { by: 1 });
await packs.transition(p.packId, 'loading', { by: 1 });

// markLoaded should only work from loading
const sidePack = await packs.create({ pack: { tenantName: 'X' }, by: 1 });
await assertThrows(
  () => packs.markLoaded(sidePack.packId, { by: 1 }),
  'illegal_transition',
  'markLoaded refuses non-loading-stage pack',
);
const loaded = await packs.markLoaded(p.packId, { propertyInspectRef: 'PI-12345', by: 1 });
assert(loaded.archived === true && loaded.propertyInspectLoadedAt && loaded.propertyInspectRef === 'PI-12345',
  'markLoaded flips archived + sets PI fields');

// Cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }

if (failed === 0) {
  console.log('\n[test] ALL PASS\n'); // eslint-disable-line no-console
  process.exit(0);
}
console.error(`\n[test] FAILED ${failed} assertion(s)\n`); // eslint-disable-line no-console
process.exit(1);
