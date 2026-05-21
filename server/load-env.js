// Side-effect-only module loaded FIRST in server.js (before any other
// import that might read process.env). Loads server/.env into env.
// Without this, AES key + session secret are missing at module-eval time
// because vanilla `import 'dotenv/config'` only looks in CWD.
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(HERE, '.env');
if (fs.existsSync(ENV_FILE)) {
  dotenv.config({ path: ENV_FILE });
}
