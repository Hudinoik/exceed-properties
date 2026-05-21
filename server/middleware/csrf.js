// ============================================================
// CSRF protection — double-submit cookie pattern.
//
// On the first request, we issue a random `ep.csrf` cookie (NOT
// httpOnly so the SPA can read it). Mutating requests (POST/PUT/PATCH/
// DELETE) must echo the cookie value back in the `X-CSRF-Token` header.
// Because cross-site requests can't read our cookie, they can't forge
// the header — even if SameSite=Lax somehow lets a malicious form
// reach us.
//
// We additionally require SameSite=Lax/Strict on the session cookie,
// so this is defense-in-depth rather than the only line.
// ============================================================
import { randomToken, timingSafeEqual } from '../crypto.js';

const CSRF_COOKIE = 'ep.csrf';
const CSRF_HEADER = 'x-csrf-token';

// Methods that mutate state — all others are exempt.
const PROTECT = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfMiddleware = (req, res, next) => {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = randomToken(24);
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // SPA must read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  if (!PROTECT.has(req.method)) return next();
  // Skip CSRF for the login endpoint — at that point the user has no
  // session yet, and the cookie+header check still defends against CSRF
  // because the attacker can't read the cookie. We DO still validate.
  const provided = req.get(CSRF_HEADER) || '';
  if (!provided || !timingSafeEqual(provided, token)) {
    return res.status(403).json({ error: 'CSRF token missing or invalid' });
  }
  next();
};

export { CSRF_COOKIE, CSRF_HEADER };
