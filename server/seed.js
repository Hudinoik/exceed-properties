// ============================================================
// First-run seed. If the users table is empty, create a bootstrap
// admin account from SEED_ADMIN_* env vars. Subsequent runs are no-ops.
//
// To force a fresh seed: delete the db file, then restart the server.
// ============================================================
import bcrypt from 'bcryptjs';
import { dbReady, users, audit } from './db.js';

export const seedIfEmpty = async () => {
  await dbReady();
  if (users.list().length > 0) {
    return { seeded: false, reason: 'users table not empty' };
  }
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMeOnFirstLogin!';
  const firstName = process.env.SEED_ADMIN_FIRST_NAME || 'Admin';
  const lastName = process.env.SEED_ADMIN_LAST_NAME || 'User';
  const role = process.env.SEED_ADMIN_ROLE || 'director';
  const hash = await bcrypt.hash(password, 12);
  const created = await users.create({
    email,
    passwordHash: hash,
    firstName,
    lastName,
    role,
    mustChangePassword: true,
  });
  await audit.log({
    userId: created.id, userEmail: created.email,
    action: 'seed.admin-created', details: { role },
  });
  // eslint-disable-next-line no-console
  console.log(`[seed] Created admin user ${email} (role=${role}). Sign in with the seeded password and change it immediately.`);
  return { seeded: true, email, role };
};

// When run directly via `npm run seed`, do the work and exit.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.js')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: './server/.env' });
  const r = await seedIfEmpty();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}
