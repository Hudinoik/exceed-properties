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
import { dbReady, webhookEvents, audit } from '../db.js';
import { requireAuth } from './auth.js';
import { verifyDocusignHmac } from '../docusign/webhook.js';

// ---- PUBLIC (unauthenticated) ----------------------------------------
// External services POST here. Uses a dedicated body parser so the main
// app's CSRF/auth pipeline doesn't block these requests.
export const publicRouter = express.Router();

// ---- DocuSign Connect webhook (MUST register BEFORE the JSON parser).
// We need the RAW request bytes to compute HMAC — JSON.parse + re-stringify
// will reorder keys and break the signature. So we attach express.raw ONLY
// to this route, and do JSON.parse manually inside the handler after the
// signature is verified.
publicRouter.post(
  '/docusign',
  express.raw({ type: 'application/json', limit: '5mb' }),
  async (req, res) => {
    // ALWAYS respond 200 quickly — DocuSign will hammer-retry on non-2xx,
    // and any internal failure is recoverable from our event log.
    // Acknowledge BEFORE doing any DB work below.
    const rawBody = req.body; // Buffer because of express.raw()
    const sigCandidates = [];
    // Connect can be configured with multiple HMAC keys; headers are
    // numbered X-DocuSign-Signature-1, -2, ... Collect them all.
    Object.keys(req.headers).forEach((h) => {
      if (h.toLowerCase().startsWith('x-docusign-signature-')) {
        const v = req.headers[h];
        if (Array.isArray(v)) sigCandidates.push(...v);
        else if (v) sigCandidates.push(v);
      }
    });
    const isValid = verifyDocusignHmac(rawBody, sigCandidates);
    if (!isValid) {
      // Log + 401 — DocuSign won't retry on 401, but invalid signatures
      // shouldn't reach our event store either way.
      // eslint-disable-next-line no-console
      console.warn('[webhook] DocuSign HMAC verification failed', {
        ip: req.ip, hasSig: sigCandidates.length > 0,
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }
    // Respond fast, then process out-of-band so a slow DB write can't
    // trigger DocuSign retries.
    res.status(200).json({ ok: true });

    // ---- post-ack processing -----------------------------------------
    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhook] DocuSign body was not JSON:', err.message);
      return;
    }

    // Connect "aggregate" / REST v2.1 envelope events carry:
    //   body.event = 'envelope-completed' | 'envelope-declined' | 'envelope-voided'
    //                | 'recipient-completed' | ...
    //   body.data.envelopeId / body.data.envelopeSummary  (depending on format)
    const eventType = body?.event || 'unknown';
    const envelopeId = body?.data?.envelopeId
      || body?.data?.envelopeSummary?.envelopeId
      || body?.envelopeId
      || null;

    // eslint-disable-next-line no-console
    console.log(`[webhook] DocuSign ${eventType} envelope=${envelopeId || 'n/a'}`);

    // Persist the raw event for visibility / replay.
    try {
      await webhookEvents.record({
        // No per-user binding for DocuSign — this is a system-account
        // integration. userId is null intentionally.
        userId: null,
        integration: 'docusign',
        headers: req.headers,
        body,
        ip: req.ip,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhook] DocuSign record failed:', err.message);
    }

    try {
      await audit.log({
        userId: null, userEmail: null,
        action: `docusign.webhook.${eventType}`,
        details: { envelopeId },
        ip: req.ip,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhook] DocuSign audit failed:', err.message);
    }

    // ------------------------------------------------------------------
    // Pack pipeline updates. Find the pack by envelopeId and apply
    // the state transition that matches this event. Webhook-driven
    // transitions bypass the user-facing rules (envelope-declined
    // can move docusign -> lease_drafting; the matrix in packs.js
    // allows this when viaWebhook: true).
    //
    // Errors here are SWALLOWED (logged only). The webhook handler
    // already replied 200 above, and DocuSign retries on non-2xx
    // would only multiply the same broken update. Better to log
    // and move on; the SPA's 30s envelope poll picks up the actual
    // status from DocuSign as a fallback.
    if (envelopeId) {
      try {
        const packs = await import('../db/packs.js');
        switch (eventType) {
          case 'envelope-sent':
          case 'envelope-delivered':
            await packs.updateEnvelopeStatus(envelopeId, { status: 'delivered' });
            break;

          case 'recipient-completed':
            // For tenant-only envelopes (the pack flow), the next
            // event after this will be envelope-completed. For multi-
            // signer envelopes from the standalone drafter, this
            // means "one signer has signed but more remain". The
            // backend uses 'partially_signed' for the latter; same
            // intermediate state in either case.
            await packs.updateEnvelopeStatus(envelopeId, { status: 'partially_signed' });
            break;

          case 'envelope-completed': {
            // Pull the signed PDF and store on the pack so "View PDF"
            // works without an additional DocuSign round-trip on every
            // page load.
            let signedPdfBase64 = null;
            try {
              const { downloadSignedDocument } = await import('../docusign/envelopes.js');
              const buf = await downloadSignedDocument(envelopeId, 'combined');
              signedPdfBase64 = buf.toString('base64');
            } catch (dlErr) {
              // eslint-disable-next-line no-console
              console.error('[webhook] DocuSign signed PDF fetch failed:', dlErr.code || '', dlErr.message);
            }
            await packs.updateEnvelopeStatus(envelopeId, {
              status: 'completed',
              signedPdfBase64,
              reason: 'Envelope completed -- all signers signed',
            });
            break;
          }

          case 'envelope-declined': {
            const pack = await packs.updateEnvelopeStatus(envelopeId, {
              status: 'declined',
              reason: 'Envelope declined by signer. Pack returned to Lease Drafting.',
            });
            if (pack && pack.stage === 'docusign') {
              try {
                await packs.transition(pack.packId, 'lease_drafting', {
                  by: null,
                  viaWebhook: true,
                  reason: 'envelope-declined webhook',
                });
              } catch (tErr) {
                // eslint-disable-next-line no-console
                console.error('[webhook] transition after decline failed:', tErr.message);
              }
            }
            break;
          }

          case 'envelope-voided': {
            const pack = await packs.updateEnvelopeStatus(envelopeId, {
              status: 'voided',
              reason: 'Envelope voided. Pack returned to Lease Drafting.',
            });
            if (pack && pack.stage === 'docusign') {
              try {
                await packs.transition(pack.packId, 'lease_drafting', {
                  by: null,
                  viaWebhook: true,
                  reason: 'envelope-voided webhook',
                });
              } catch (tErr) {
                // eslint-disable-next-line no-console
                console.error('[webhook] transition after void failed:', tErr.message);
              }
            }
            break;
          }

          default:
            // Unknown event type -- already logged + recorded above.
            break;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[webhook] DocuSign ${eventType} pack-update failed:`, err.message);
      }
    }
  },
);

// Now the JSON parser for everything ELSE on this router (PI webhook
// below). DocuSign is already handled above with its own raw parser.
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

// ---- DocuSign webhook event log (system-scoped, not per-user) --------
// DocuSign is a single-tenant integration for Exceed Props, so events
// aren't keyed to a user. List the most recent N for any authenticated
// admin to inspect. Filtering happens here rather than in db.js because
// webhookEvents.list() expects a userId.
apiRouter.get('/docusign/events', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const db = await dbReady();
  const list = db.data.webhookEvents
    .filter(e => e.integration === 'docusign')
    .slice(0, limit);
  const events = list.map(e => ({
    id: e.id,
    receivedAt: e.receivedAt,
    ip: e.ip,
    headers: e.headers ? safeJsonParse(e.headers) : null,
    body: e.body ? safeJsonParse(e.body) : null,
  }));
  res.json({ events });
});

apiRouter.delete('/docusign/events', async (req, res) => {
  const db = await dbReady();
  const before = db.data.webhookEvents.length;
  db.data.webhookEvents = db.data.webhookEvents.filter(e => e.integration !== 'docusign');
  const removed = before - db.data.webhookEvents.length;
  if (removed) await db.write();
  res.json({ ok: true, removed });
});
