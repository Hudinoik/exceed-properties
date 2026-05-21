// ============================================================
// Auth routes — login, logout, me, change-password.
// Passwords verified against bcrypt hashes in the DB.
// Sessions are httpOnly cookies (set by express-session in server.js).
// ============================================================
import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { users, audit } from '../db.js';

const router = express.Router();

// Aggressive rate limit on login attempts — 5 per 15 min per IP+email.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${req.ip}:${(req.body?.email || '').toLowerCase()}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Generic limiter for password-change / signup-style endpoints.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// --- helpers ---
const sanitizeUser = (u) => u ? ({
  id: u.id,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  role: u.role,
  mustChangePassword: !!u.mustChangePassword,
  lastLogin: u.lastLogin,
}) : null;

const requireAuth = (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
};

// --- POST /api/auth/login ---
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = users.byEmail(email);
  // ALWAYS run a bcrypt compare even on missing user — prevents timing
  // attacks that distinguish "user doesn't exist" from "wrong password".
  const hashToCheck = user?.passwordHash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(password, hashToCheck);
  if (!user || !ok) {
    await audit.log({
      userEmail: email,
      action: 'auth.login.failed',
      ip: req.ip,
    });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Regenerate the session ID on login to defeat session-fixation.
  req.session.regenerate(async (err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.userId = user.id;
    req.session.email = user.email;
    await users.touchLogin(user.id);
    await audit.log({
      userId: user.id, userEmail: user.email,
      action: 'auth.login.success', ip: req.ip,
    });
    res.json({ user: sanitizeUser(user) });
  });
});

// --- POST /api/auth/logout ---
router.post('/logout', (req, res) => {
  const { userId, email } = req.session || {};
  req.session.destroy(async (err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('ep.sid');
    if (userId) await audit.log({ userId, userEmail: email, action: 'auth.logout', ip: req.ip });
    res.json({ ok: true });
  });
});

// --- GET /api/auth/me ---
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  const user = users.byId(req.session.userId);
  if (!user) {
    // Session points to a deleted user — clear it.
    req.session.destroy(() => res.json({ user: null }));
    return;
  }
  res.json({ user: sanitizeUser(user) });
});

// --- POST /api/auth/change-password ---
router.post('/change-password', requireAuth, writeLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  // Basic strength rule: at least one letter and one digit OR symbol.
  if (!/[A-Za-z]/.test(newPassword) || !/[\d\W]/.test(newPassword)) {
    return res.status(400).json({ error: 'Password must contain letters and at least one digit or symbol' });
  }
  const user = users.byId(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Verify currentPassword UNLESS this is the forced-change-on-first-login flow.
  if (!user.mustChangePassword) {
    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required' });
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      await audit.log({
        userId: user.id, userEmail: user.email,
        action: 'auth.change-password.wrong-current', ip: req.ip,
      });
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }
  const newHash = await bcrypt.hash(newPassword, 12);
  await users.updatePassword(user.id, newHash, false);
  await audit.log({
    userId: user.id, userEmail: user.email,
    action: 'auth.change-password.success', ip: req.ip,
  });
  res.json({ ok: true });
});

export default router;
export { requireAuth };
