// ============================================================
// Webhook receiver — inbound POSTs from external services.
//
// External services (Property Inspect, etc.) post here when something
// happens server-side. The endpoint is intentionally UNAUTHENTICATED:
// external services don't have our session cookie. Instead, the URL
// itself contains a per-user random token that identifies which user
// the event belongs to. Anyone with the token can post to it — that's
// fine because the only thing they can do is record an event for that
// user, which the user can review and clear at will.
//
// Mounted in server.js BEFORE the session/auth middleware so it isn't
// gated by login or CSRF. Has its own JSON body parser with a smaller
// size limit than the rest of the app.
// ============================================================
import express from 'express';
import { dbReady, webhookEvents } from '../db.js';
import { requireAuth } from './auth.js';

// ---- PUBLIC (unauthenticated) ----------------------------------------
// External services POST here. Uses a dedicated body parser so the main
// app's CSRF/auth pipeline doesn't block these requests.
export const publicRouter = express.Router();
publicRouter.use(express.json({ limit: '1mb' }));

const safeJsonParse = (s) => { try { return JSON.parse(s); } catch { return s; } };

publicRouter.post('/property-inspect/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (!token || token.length < 16) {
    return res.status(404).json({ error: 'Not found' });
  }
  const db = await dbReady();
  const row = db.data.secrets.find(
    s => s.integration === 'propertyInspect' && s.key === 'webhookToken' && s.ciphertext === token,
  );
  if (!row) {
    // Don't reveal whether the token is partial-match vs. unknown.
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    await webhookEvents.record({
      userId: row.userId,
      integration: 'propertyInspect',
      headers: req.headers,
      body: req.body,
      ip: req.ip,
    });
  } catch (err) {
    // Don't fail the webhook — log and accept. Most webhook senders
    // retry on non-2xx, which would multiply identical events in the db.
    // eslint-disable-next-line no-console
    console.error('[webhook] PI record failed:', err.message);
  }
  res.status(200).json({ ok: true });
});

// ---- AUTHENTICATED (UI / app code) ------------------------------------
// The integration card uses these to manage the per-user token and to
// list received events.
export const apiRouter = express.Router();
apiRouter.use(requireAuth);

apiRouter.get('/property-inspect/events', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const list = webhookEvents.list(req.session.userId, 'propertyInspect', limit);
  // Parse the stored JSON strings back into objects for client consumption.
  const events = list.map(e => ({
    id: e.id,
    receivedAt: e.receivedAt,
    ip: e.ip,
    headers: e.headers ? safeJsonParse(e.headers) : null,
    body: e.body ? safeJsonParse(e.body) : null,
  }));
  res.json({ events });
});

apiRouter.delete('/property-inspect/events', async (req, res) => {
  const removed = await webhookEvents.clear(req.session.userId, 'propertyInspect');
  res.json({ ok: true, removed });
});
