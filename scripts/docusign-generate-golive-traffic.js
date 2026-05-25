// ============================================================
// DocuSign Go-Live API traffic generator.
//
// Runs the smoke test five times in sequence against whichever
// environment is currently configured (intended use: DEMO).
// Each run exercises six distinct API method types, so a full
// pass logs 30 successful API calls across six method types —
// well above DocuSign's Go-Live thresholds (≥20 calls across
// ≥5 method types).
//
// Usage:
//   TEST_RECIPIENT_EMAIL=you@example.com node scripts/docusign-generate-golive-traffic.js
//
// Heads-up: each run delivers ONE email to TEST_RECIPIENT_EMAIL,
// so you'll see five emails after this script finishes. Filter
// them by the subject suffix "(go-live run N of 5)".
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_TEST = path.join(HERE, 'docusign-smoke-test.js');
const RUNS = 5;

// Run the smoke test once as a child process, inheriting stdio
// so the user sees the same output they'd see running it directly.
const runOnce = (n) => new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath, // current node binary
    [SMOKE_TEST],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_SUBJECT_SUFFIX: `(go-live run ${n} of ${RUNS})`,
      },
    },
  );
  child.on('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`Run ${n} failed with exit code ${code}`));
  });
  child.on('error', reject);
});

const main = async () => {
  // eslint-disable-next-line no-console
  console.log(`\n=== DocuSign Go-Live traffic generator ===`);
  // eslint-disable-next-line no-console
  console.log(`Running smoke test ${RUNS} times. Target: ≥20 calls across ≥5 method types.\n`);
  let succeeded = 0;
  for (let i = 1; i <= RUNS; i++) {
    // eslint-disable-next-line no-console
    console.log(`\n----- Run ${i} of ${RUNS} -----`);
    try {
      await runOnce(i);
      succeeded += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Run ${i} failed: ${err.message}`);
      // Continue — partial completion is still useful for diagnostics,
      // and DocuSign counts every successful call even when others fail.
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\n=== Traffic generator finished: ${succeeded}/${RUNS} runs succeeded ===`);
  // eslint-disable-next-line no-console
  console.log(`Each successful run = 6 API calls across 6 method types.`);
  // eslint-disable-next-line no-console
  console.log(`Total successful calls: ${succeeded * 6} across 6 method types.\n`);
  process.exit(succeeded === RUNS ? 0 : 1);
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  process.exit(1);
});
