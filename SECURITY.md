# Security model

This is a property-management SPA backed by an Express server. The browser
never sees raw API keys, OAuth tokens, or password material — every
credential is held server-side, encrypted at rest, and only used when the
backend forwards calls to upstream APIs on behalf of an authenticated user.

## What the browser can see vs. what the server holds

| Data                              | Browser           | Server               |
| --------------------------------- | ----------------- | -------------------- |
| User passwords                    | Never             | bcrypt cost 12       |
| Anthropic API key                 | Last 4 chars only | AES-256-GCM encrypted |
| DocuSign integration key + secret | Last 4 chars only | AES-256-GCM encrypted |
| DocuSign access + refresh tokens  | Never             | AES-256-GCM encrypted |
| Property Inspect client secret    | Last 4 chars only | AES-256-GCM encrypted |
| Property Inspect access tokens    | Never             | AES-256-GCM encrypted |
| Session ID                        | Yes, httpOnly cookie | Yes, in DB        |
| CSRF token                        | Yes, readable cookie | Yes, validated server-side |

## Auth

* **Passwords**: bcrypt with cost 12. Server-only comparison via
  `bcrypt.compare`. We always run the compare even on missing users to
  defeat timing-based account-enumeration.
* **Sessions**: `express-session` with `httpOnly`, `SameSite=Lax`, `secure`
  (in production), 7-day rolling expiry. Stored in the lowdb-backed DB
  via a custom store. Session ID is regenerated on login to defeat
  fixation attacks.
* **Rate limiting**: 10 login attempts per IP+email per 15 minutes,
  20 password-change attempts per IP per minute, 300 generic requests
  per IP per minute. Configurable in `server/routes/auth.js`.
* **First-login forced password change**: seeded users have
  `mustChangePassword = true`; the SPA shows a non-dismissible modal
  until they set a real password.
* **Password policy**: 8+ chars, must contain letters AND
  (digit OR symbol). Enforced server-side in `auth.js`.

## CSRF

Double-submit cookie pattern in `server/middleware/csrf.js`:

1. First response sets a random `ep.csrf` cookie (readable by JS, **not**
   httpOnly).
2. Mutating verbs (POST/PUT/PATCH/DELETE) must echo the same value back
   in the `X-CSRF-Token` request header.
3. Because cross-origin requests can't read our cookie, they can't forge
   the header.

The frontend's `src/lib/api.js` reads the cookie and attaches the header
automatically.

## Secrets vault

`server/routes/secrets.js` exposes a per-user vault. Schema:

```
secrets(id, userId, integration, key, ciphertext, iv, authTag, updatedAt)
```

Sensitive values (API keys, tokens, secrets) go through AES-256-GCM with
a master key from `ENCRYPTION_KEY` (32 bytes, base64). Non-sensitive
keys (URLs, identifiers, environment selectors) are stored as plaintext
for retrieval ergonomics — they're whitelisted in `PLAINTEXT_KEYS`.

GET responses **never** return the plaintext of an encrypted value —
only `last4`, `length`, and `hasValue`. The plaintext is only ever
decrypted server-side, in-process, when a proxy endpoint needs to
forward it to the upstream API.

## Proxy endpoints

`server/routes/proxy.js` exposes:

* `POST /api/proxy/anthropic/messages` — forwards to Claude API with the
  user's stored key
* `POST /api/proxy/docusign/exchange-code` — exchanges the OAuth code
  for tokens server-side (the client_secret never leaves the server)
* `POST /api/proxy/docusign/create-envelope` — auto-refreshes the access
  token if expired, then creates the envelope
* `GET  /api/proxy/docusign/envelope/:id` — read envelope status
* `POST /api/proxy/property-inspect/exchange-code` — same shape
* `GET  /api/proxy/property-inspect/get?path=…` — read-only GET
  forwarder with path validation (no `/oauth/*`, no traversal)

## Security headers

`helmet` is mounted globally with default options (CSP relaxed in dev to
allow Vite's inline eval; tighten in prod). HSTS, X-Content-Type-Options,
Referrer-Policy, X-Frame-Options all set.

## Audit trail

Every meaningful state change is logged to the `audit_log` collection
with userId, userEmail, action, and IP. Bounded to the latest 5000
entries. Inspect via the existing Settings → Audit Log page (which
will be wired to read from the backend in a follow-up).

## Key management

* `SESSION_SECRET` and `ENCRYPTION_KEY` live in `server/.env` for local
  dev (gitignored).
* In production set them via your hosting platform's secret store
  (Render → "Environment", Railway → "Variables", Fly.io → `fly secrets set`).
* **Rotate `SESSION_SECRET`** to invalidate every active session
  (forces all users to log in again). Reversible.
* **Do NOT lose `ENCRYPTION_KEY`** — losing it makes every stored
  secret unrecoverable. Back it up in a password manager / KMS
  out-of-band. If you must rotate it, you have to also re-encrypt
  every row in the `secrets` table (script not yet written; ping if needed).

## Threats this model defends against

* **XSS exfiltrating API keys** — the keys aren't in the DOM. Worst
  case an attacker can issue API calls via the proxy endpoints, but
  they need the session cookie (httpOnly) AND the CSRF token. They
  can't steal keys to use later from a different origin/session.
* **CSRF** — double-submit cookie + SameSite=Lax.
* **Session fixation** — regenerate ID on login.
* **Login brute-force** — rate limiter.
* **Account enumeration** — constant-time bcrypt on missing users.
* **Disk theft of DB file** — secrets encrypted with key not in the file.
* **Code injection on the SPA** — server enforces session+CSRF+rate
  limits regardless of what runs client-side.

## Threats this model does NOT defend against

* **Compromise of the server host** — if the attacker has shell on the
  server they have both the DB file AND `ENCRYPTION_KEY`. Mitigate via
  hosting-platform security, dependency hygiene, OS patching.
* **A logged-in user with malicious intent** — a real user with a
  valid session can do anything their role allows. The audit log is
  the after-the-fact deterrent.
* **Browser extension / OS-level malware on the user's machine** —
  out of scope; can read the session cookie, can read CSRF token, can
  drive the SPA as the user.
* **Phishing** — out of scope. Encourage MFA at the OS / browser /
  email level.

## Production checklist

Before going live:

- [ ] `NODE_ENV=production` set on the host
- [ ] `SESSION_SECRET` and `ENCRYPTION_KEY` generated fresh (NOT the
      dev values from `server/.env.example`)
- [ ] `CLIENT_ORIGIN` matches the real public URL (no trailing slash)
- [ ] HTTPS terminates in front of the Node process (Render/Railway/etc.
      do this automatically)
- [ ] Database file lives on a persistent disk mount, not the
      ephemeral instance filesystem
- [ ] Seed admin password (`SEED_ADMIN_PASSWORD`) is a one-time value
      that the real admin will change on first login
- [ ] Remove or rotate `SEED_ADMIN_*` env vars after first deploy
- [ ] `dist/` is built (`npm run build`) so the same Node process
      serves the SPA static files
- [ ] Daily backup of the DB file is configured

See `DEPLOY.md` for the step-by-step.
