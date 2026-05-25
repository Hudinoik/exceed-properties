// ============================================================
// Standalone DocuSign JWT auth smoke test.
//
// Usage (from the project root):
//   node scripts/test-docusign-auth.js
//
// Loads server/.env via the same mechanism server.js does, then
// requests a JWT access token. Prints a short success diagnostic
// (no token bytes) or the failure reason. Run this before you
// trust the integration end-to-end.
// ============================================================
import '../server/load-env.js';
import { getAccessToken, _clearTokenCache } from '../server/docusign/auth.js';

const redact = (s, keep = 4) => {
  if (!s) return '(unset)';
  if (s.length <= keep) return '***';
  return `***${s.slice(-keep)}`;
};

const summary = () => {
  // eslint-disable-next-line no-console
  console.log('--- DocuSign config (env vars) ---');
  // eslint-disable-next-line no-console
  console.log('  DOCUSIGN_OAUTH_HOST    =', process.env.DOCUSIGN_OAUTH_HOST || '(default: account-d.docusign.com)');
  // eslint-disable-next-line no-console
  console.log('  DOCUSIGN_BASE_PATH     =', process.env.DOCUSIGN_BASE_PATH || '(default: https://demo.docusign.net/restapi)');
  // eslint-disable-next-line no-console
  console.log('  DOCUSIGN_INTEGRATION_KEY =', redact(process.env.DOCUSIGN_INTEGRATION_KEY));
  // eslint-disable-next-line no-console
  console.log('  DOCUSIGN_USER_ID         =', redact(process.env.DOCUSIGN_USER_ID));
  // eslint-disable-next-line no-console
  console.log('  DOCUSIGN_ACCOUNT_ID      =', redact(process.env.DOCUSIGN_ACCOUNT_ID));
  // eslint-disable-next-line no-console
  console.log('  DOCUSIGN_PRIVATE_KEY     =', process.env.DOCUSIGN_PRIVATE_KEY ? `(set, ${String(process.env.DOCUSIGN_PRIVATE_KEY).length} chars)` : '(unset)');
  // eslint-disable-next-line no-console
  console.log('  DOCUSIGN_WEBHOOK_SECRET  =', process.env.DOCUSIGN_WEBHOOK_SECRET ? '(set)' : '(unset)');
  // eslint-disable-next-line no-console
  console.log('');
};

const main = async () => {
  summary();
  _clearTokenCache(); // force a real round-trip
  try {
    const token = await getAccessToken();
    // eslint-disable-next-line no-console
    console.log('✅ JWT auth succeeded.');
    // eslint-disable-next-line no-console
    console.log('   Token length:', token.length, 'chars');
    // eslint-disable-next-line no-console
    console.log('   Token suffix:', redact(token, 8));
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('❌ JWT auth FAILED.');
    // eslint-disable-next-line no-console
    console.error('   code:   ', err.code || '(none)');
    // eslint-disable-next-line no-console
    console.error('   message:', err.message);
    if (err.upstream) {
      // eslint-disable-next-line no-console
      console.error('   upstream:', err.upstream);
    }
    process.exit(1);
  }
};

main();
