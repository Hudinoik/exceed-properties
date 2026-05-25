// ============================================================
// Exceed Properties — backend entry point.
//
// Express server providing:
//   - /api/auth/*    user authentication (login/logout/me/change-password)
//   - /api/secrets/* per-user encrypted secrets vault
//   - /api/proxy/*   server-side calls to external APIs (Anthropic, DocuSign, PI)
//
// All sensitive operations require an authenticated session. The SPA
// never receives raw API keys / OAuth tokens after the initial save —
// only metadata (last-4 chars, presence, length).
// ============================================================
import './load-env.js'; // MUST be first — populates process.env before crypto.js etc.
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { dbReady, LowdbSessionStore } from './db.js';
import { csrfMiddleware } from './middleware/csrf.js';
import authRouter from './routes/auth.js';
import secretsRouter from './routes/secrets.js';
import proxyRouter from './routes/proxy.js';
import docusignRouter from './routes/docusign.js';
import { publicRouter as webhookPublicRouter, apiRouter as webhookApiRouter } from './routes/webhooks.js';
import { isProduction as docusignIsProduction } from './docusign/auth.js';
import { seedIfEmpty } from './seed.js';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

// --- env validation ---
const PORT = Number(process.env.PORT) || 4000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const IS_PROD = process.env.NODE_ENV === 'production';

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  // eslint-disable-next-line no-console
  console.error('[server] SESSION_SECRET env var is required (32+ chars). Set it in server/.env');
  process.exit(1);
}
if (!ENCRYPTION_KEY) {
  // eslint-disable-next-line no-console
  console.error('[server] ENCRYPTION_KEY env var is required. Generate one with:');
  // eslint-disable-next-line no-console
  console.error("        node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"");
  process.exit(1);
}

await dbReady();
await seedIfEmpty();

const app = express();
app.set('trust proxy', 1); // behind a reverse proxy (Render etc.)

// --- security headers ---
app.use(helmet({
  contentSecurityPolicy: IS_PROD ? undefined : false, // Vite dev needs eval/inline
  crossOriginEmbedderPolicy: false,
}));

// --- CORS — only the SPA's origin, with credentials ---
app.use(cors({
  origin: CLIENT_ORIGIN,
  credentials: true,
}));

app.use(cookieParser());

// --- public webhook receiver — mounted BEFORE the global JSON parser, rate
//     limit, CSRF, and session. External services (PI, DocuSign) can POST
//     without our auth cookie. PI uses a per-user URL token; DocuSign uses
//     HMAC signature verification.
//
//     CRITICAL: this must come before app.use(express.json()) below — the
//     DocuSign webhook needs the RAW body bytes for HMAC verification, and
//     its route registers its own express.raw() parser. If the global JSON
//     parser ran first, the body stream would already be consumed.
//     The webhook router attaches its own express.json() to handle every
//     route other than /docusign (PI etc.).
app.use('/api/webhooks', webhookPublicRouter);

// --- body + cookies — global parser for everything except webhooks above ---
app.use(express.json({ limit: '20mb' })); // lease DOCX base64 can be large

// --- sessions ---
app.use(session({
  name: 'ep.sid',
  store: new LowdbSessionStore(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // refresh expiry on every request
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  },
}));

// --- global rate limit (defence-in-depth on top of per-route limits) ---
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}));

// --- CSRF protection — issues+validates the double-submit cookie ---
app.use('/api/', csrfMiddleware);

// --- routes ---
app.use('/api/auth', authRouter);
app.use('/api/secrets', secretsRouter);
app.use('/api/proxy', proxyRouter);
app.use('/api/docusign', docusignRouter);
// Authenticated mgmt endpoints for webhooks (list events, clear, etc.).
// The public receiver is mounted earlier, before CSRF/session.
app.use('/api/webhooks', webhookApiRouter);

// Health probe (un-authed; used by hosting platforms)
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// --- production static serving ---
// In prod, serve the built SPA from dist/ so frontend + backend are
// same-origin. In dev, Vite runs on its own port and proxies /api/* to here.
if (IS_PROD) {
  const distDir = path.join(SERVER_DIR, '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn('[server] NODE_ENV=production but dist/ is missing. Run `npm run build` first.');
  }
}

// --- 404 + error handlers ---
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  // eslint-disable-next-line no-console
  console.log(`[server] CORS allowed origin: ${CLIENT_ORIGIN}`);
  // DocuSign environment banner. Loud, deliberate — operators glancing
  // at Render logs should instantly see whether this dyno is talking
  // to demo or prod. Base path is auto-discovered per-request via
  // /oauth/userinfo so we don't print it here (would be misleading
  // pre-first-request).
  const dsProd = docusignIsProduction();
  const dsHost = process.env.DOCUSIGN_OAUTH_HOST || 'account-d.docusign.com';
  // eslint-disable-next-line no-console
  console.log(`[docusign] environment: ${dsProd ? 'PRODUCTION' : 'DEMO'} (oauth host=${dsHost}, base path auto-discovered)`);
  if (dsProd && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn('[docusign] ⚠️  WARNING: DocuSign is set to PRODUCTION but NODE_ENV is not "production". Real envelopes will be sent against live customers if you exercise the API. Double-check this is intentional.');
  }
});
