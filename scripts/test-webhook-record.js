// ============================================================
// Standalone repro / regression test for the webhook-record bug.
//
// Bug background: server/db.js declared `webhookEvents: []` in
// DEFAULT_DATA, but production's app.json predates that addition.
// lowdb's JSONFilePreset(file, defaults) only applies `defaults`
// when the file is missing — for an existing file it loads
// whatever's there. Result: db.data.webhookEvents === undefined,
// and webhookEvents.record() crashed with "Cannot read properties
// of undefined (reading 'unshift')" the first time a DocuSign or
// PI webhook arrived in production.
//
// This script proves the fix is in place by:
//   1. Creating an isolated temp DATABASE_PATH that does NOT
//      contain the webhookEvents key (simulates pre-migration db)
//   2. Importing server/db.js (which runs migrateSchema on load)
//   3. Calling webhookEvents.record(...)
//   4. Asserting no throw + the event was persisted + the file
//      now contains the webhookEvents array
//
// Run:
//   node scripts/test-webhook-record.js
// Exit 0 on pass, 1 on fail. Use as a sanity check after
// touching server/db.js or webhookEvents.
//
// No test framework — this is intentionally a plain Node script.
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set DATABASE_PATH BEFORE importing db.js — that module reads it
// at import time. Build a stub app.json that intentionally lacks
// webhookEvents and nextId.webhook (pre-migration state).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-webhook-test-'));
const tmpDbPath = path.join(tmpDir, 'app.json');
const PRE_MIGRATION_STATE = {
  users: [],
  secrets: [],
  auditLog: [],
  sessions: [],
  // INTENTIONALLY missing: webhookEvents
  nextId: { user: 1, secret: 1, audit: 1 }, // INTENTIONALLY missing: webhook
};
fs.writeFileSync(tmpDbPath, JSON.stringify(PRE_MIGRATION_STATE, null, 2));
process.env.DATABASE_PATH = tmpDbPath;

const log = (...args) => console.log('[test]', ...args); // eslint-disable-line no-console
const die = (msg) => {
  console.error('[test] FAIL —', msg); // eslint-disable-line no-console
  process.exit(1);
};

const { dbReady, webhookEvents } = await import('../server/db.js');

const main = async () => {
  log(`Using temp db at ${tmpDbPath}`);

  // Sanity: the file we wrote really did lack webhookEvents.
  const onDiskBefore = JSON.parse(fs.readFileSync(tmpDbPath, 'utf8'));
  if (onDiskBefore.webhookEvents !== undefined) {
    die('precondition: temp db unexpectedly already has webhookEvents key');
  }
  log('precondition ok: temp db has no webhookEvents key');

  // dbReady() resolves after migrateSchema() runs. Confirm migration
  // filled the missing keys.
  await dbReady();
  const onDiskAfterMigration = JSON.parse(fs.readFileSync(tmpDbPath, 'utf8'));
  if (!Array.isArray(onDiskAfterMigration.webhookEvents)) {
    die('migration did not create db.data.webhookEvents array');
  }
  if (onDiskAfterMigration.nextId?.webhook === undefined) {
    die('migration did not create db.data.nextId.webhook');
  }
  log('migration ok: webhookEvents array present, nextId.webhook present');

  // Exercise webhookEvents.record — this is what crashed in prod.
  // Use a synthetic DocuSign payload to mirror the real call site.
  let recorded;
  try {
    recorded = await webhookEvents.record({
      userId: null,
      integration: 'docusign',
      headers: { 'x-docusign-signature-1': 'fake' },
      body: { event: 'envelope-completed', data: { envelopeId: 'env_test_001' } },
      ip: '127.0.0.1',
    });
  } catch (err) {
    die(`webhookEvents.record threw: ${err.message}`);
  }
  if (!recorded || typeof recorded.id !== 'number') {
    die('webhookEvents.record returned no id');
  }
  log(`record ok: created event-id=${recorded.id}`);

  // Confirm it actually landed on disk.
  const onDiskAfterRecord = JSON.parse(fs.readFileSync(tmpDbPath, 'utf8'));
  if (!Array.isArray(onDiskAfterRecord.webhookEvents) || onDiskAfterRecord.webhookEvents.length !== 1) {
    die(`expected 1 webhook event on disk, found ${onDiskAfterRecord.webhookEvents?.length}`);
  }
  const stored = onDiskAfterRecord.webhookEvents[0];
  if (stored.integration !== 'docusign') {
    die(`stored event has wrong integration: ${stored.integration}`);
  }
  if (stored.id !== recorded.id) {
    die(`stored event id ${stored.id} != returned id ${recorded.id}`);
  }
  log('persist ok: event landed on disk with correct integration + id');

  // Cleanup.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best-effort */ }

  console.log('\n[test] PASS\n'); // eslint-disable-line no-console
  process.exit(0);
};

main().catch((err) => {
  console.error('[test] unhandled error:', err); // eslint-disable-line no-console
  process.exit(1);
});
