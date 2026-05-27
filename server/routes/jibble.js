// ============================================================
// Jibble-related app-side routes (NOT proxy routes -- proxying lives
// in proxy.js).
//
// Currently exposes the time-entry adjustments audit log. Every change
// the user makes through the Adjust modal hits this endpoint after the
// upstream Jibble write succeeds, so the team has a written record
// (with a mandatory reason note) of every manual edit.
// ============================================================
import express from 'express';
import { jibbleAdjustments } from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/adjustments', (req, res) => {
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));
  const rows = jibbleAdjustments.list(req.session.userId, limit);
  res.json({ adjustments: rows });
});

router.post('/adjustments', async (req, res) => {
  const { action, inEventId, outEventId, personId, note, diff } = req.body || {};
  if (!['create', 'edit', 'delete'].includes(action)) {
    return res.status(400).json({ error: `Invalid action '${action}'` });
  }
  if (!note || typeof note !== 'string' || !note.trim()) {
    return res.status(400).json({ error: 'A reason note is required for every adjustment' });
  }
  // At least one of inEventId / outEventId must be present unless this is a
  // create -- a create can carry both ids that came back from Jibble.
  if (action !== 'create' && !inEventId && !outEventId) {
    return res.status(400).json({ error: 'inEventId or outEventId is required' });
  }
  try {
    const row = await jibbleAdjustments.create({
      userId: req.session.userId,
      userEmail: req.session.email,
      action,
      inEventId: inEventId || null,
      outEventId: outEventId || null,
      personId: personId || null,
      note: note.trim(),
      diff: diff && typeof diff === 'object' ? diff : null,
    });
    res.status(201).json({ adjustment: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
