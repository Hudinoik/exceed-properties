// ============================================================
// Data layer — lowdb (file-backed JSON).
//
// We use lowdb because it has no native build deps and works on every
// platform Node runs on. For low-scale workloads (handful of users,
// small dataset) this is sufficient. To migrate to Postgres later,
// swap the implementations behind these named exports — the API
// (`users.create`, `secrets.upsert`, etc.) stays stable.
// ============================================================
import { JSONFilePreset } from 'lowdb/node';
import path from 'node:path';
import fs from 'node:fs';
import session from 'express-session';

const DB_PATH = process.env.DATABASE_PATH || './server/data/app.json';

// Ensure parent directory exists — lowdb won't create it for us.
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const DEFAULT_DATA = {
  users: [],
  secrets: [],   // { id, userId, integration, key, ciphertext, iv, authTag, updatedAt }
  auditLog: [],  // { id, userId, userEmail, action, details, ip, createdAt }
  sessions: [],  // { sid, sess (JSON), expires (ms) }
  // Incoming webhook events from external services (Property Inspect, etc).
  // { id, userId, integration, receivedAt, headers (JSON), body (JSON or string), ip }
  webhookEvents: [],
  // Lease packs — see server/db/packs.js for the full record shape and
  // stage-transition rules. Each pack is one end-to-end lease workflow
  // from Offer Sent through to Loading-into-Property-Inspect. Files
  // (draft DOCX/PDF, signed PDF, FICA docs) are stored inline as
  // base64 inside the relevant fields — see lease-storage.js.
  packs: [],
  nextId: { user: 1, secret: 1, audit: 1, webhook: 1, pack: 1 },
};

let db;
// Schema migration on load. JSONFilePreset's `defaults` argument is only
// applied when the file is being created from scratch — if the file
// already exists, lowdb loads it as-is and never merges new top-level
// keys you added to DEFAULT_DATA later. That's how we ended up with
// `db.data.webhookEvents === undefined` on production: the file
// pre-dates the webhook-events table, so writes against it crashed
// with "Cannot read properties of undefined (reading 'unshift')".
//
// Fix: after load, walk DEFAULT_DATA and fill any missing top-level
// key (and any missing nextId sub-key) with the default. Idempotent;
// runs on every boot. Persists only if it changed something.
const migrateSchema = async () => {
  const filled = [];
  for (const [key, defaultValue] of Object.entries(DEFAULT_DATA)) {
    if (key === 'nextId') continue; // handled below
    if (db.data[key] === undefined) {
      // Deep-clone the default so the in-memory db doesn't share a
      // reference with DEFAULT_DATA (would let later mutations leak
      // into the constant).
      db.data[key] = Array.isArray(defaultValue) ? [] : { ...defaultValue };
      filled.push(key);
    }
  }
  if (!db.data.nextId || typeof db.data.nextId !== 'object') {
    db.data.nextId = { ...DEFAULT_DATA.nextId };
    filled.push('nextId');
  } else {
    for (const [subkey, defaultValue] of Object.entries(DEFAULT_DATA.nextId)) {
      if (db.data.nextId[subkey] === undefined) {
        db.data.nextId[subkey] = defaultValue;
        filled.push(`nextId.${subkey}`);
      }
    }
  }
  if (filled.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[db] schema migration filled missing keys: ${filled.join(', ')}`);
    await db.write();
  }
};

const ready = JSONFilePreset(DB_PATH, DEFAULT_DATA).then(async (instance) => {
  db = instance;
  await migrateSchema();
  return db;
});

export const dbReady = () => ready;

// Auto-flush helper. lowdb is in-memory; we have to call .write() to
// persist. Every mutation should await this.
const persist = async () => {
  await db.write();
};

// Generate the next monotonic id for a given table without colliding.
const nextId = (key) => {
  db.data.nextId = db.data.nextId || {};
  db.data.nextId[key] = (db.data.nextId[key] || 0) + 1;
  return db.data.nextId[key];
};

// ----- Users ------------------------------------------------------------

export const users = {
  byEmail(email) {
    if (!email) return null;
    return db.data.users.find(u => u.email.toLowerCase() === String(email).toLowerCase()) || null;
  },
  byId(id) {
    return db.data.users.find(u => u.id === id) || null;
  },
  list() {
    return db.data.users.slice();
  },
  async create({ email, passwordHash, firstName, lastName, role = 'readonly', mustChangePassword = false }) {
    if (this.byEmail(email)) throw new Error('Email already exists');
    const user = {
      id: nextId('user'),
      email: String(email).toLowerCase(),
      passwordHash,
      firstName: firstName || '',
      lastName: lastName || '',
      role,
      mustChangePassword: !!mustChangePassword,
      createdAt: new Date().toISOString(),
      lastLogin: null,
    };
    db.data.users.push(user);
    await persist();
    return user;
  },
  async updatePassword(id, passwordHash, mustChangePassword = false) {
    const u = this.byId(id);
    if (!u) throw new Error('User not found');
    u.passwordHash = passwordHash;
    u.mustChangePassword = mustChangePassword;
    await persist();
    return u;
  },
  async touchLogin(id) {
    const u = this.byId(id);
    if (!u) return null;
    u.lastLogin = new Date().toISOString();
    await persist();
    return u;
  },
};

// ----- Secrets ----------------------------------------------------------
// One row per (userId, integration, key). Each value is encrypted via
// crypto.js before reaching this layer — we just store the ciphertext.

export const secrets = {
  list(userId, integration) {
    return db.data.secrets.filter(s => s.userId === userId && (!integration || s.integration === integration));
  },
  byKey(userId, integration, key) {
    return db.data.secrets.find(s => s.userId === userId && s.integration === integration && s.key === key) || null;
  },
  async upsert({ userId, integration, key, ciphertext, iv, authTag }) {
    let row = this.byKey(userId, integration, key);
    if (row) {
      row.ciphertext = ciphertext;
      row.iv = iv;
      row.authTag = authTag;
      row.updatedAt = new Date().toISOString();
    } else {
      row = {
        id: nextId('secret'),
        userId, integration, key,
        ciphertext, iv, authTag,
        updatedAt: new Date().toISOString(),
      };
      db.data.secrets.push(row);
    }
    await persist();
    return row;
  },
  async deleteByIntegration(userId, integration) {
    const before = db.data.secrets.length;
    db.data.secrets = db.data.secrets.filter(s => !(s.userId === userId && s.integration === integration));
    if (db.data.secrets.length !== before) await persist();
    return before - db.data.secrets.length;
  },
  async deleteByKey(userId, integration, key) {
    const before = db.data.secrets.length;
    db.data.secrets = db.data.secrets.filter(
      s => !(s.userId === userId && s.integration === integration && s.key === key),
    );
    if (db.data.secrets.length !== before) await persist();
    return before - db.data.secrets.length;
  },
};

// ----- Audit log --------------------------------------------------------

export const audit = {
  async log({ userId, userEmail, action, details, ip }) {
    db.data.auditLog.unshift({
      id: nextId('audit'),
      userId: userId || null,
      userEmail: userEmail || null,
      action,
      details: details ? JSON.stringify(details) : null,
      ip: ip || null,
      createdAt: new Date().toISOString(),
    });
    // Keep last 5000 entries to bound the file size.
    if (db.data.auditLog.length > 5000) {
      db.data.auditLog = db.data.auditLog.slice(0, 5000);
    }
    await persist();
  },
  recent(limit = 100) {
    return db.data.auditLog.slice(0, limit);
  },
};

// ----- Webhook events ---------------------------------------------------
// Inbound POSTs from external services. Keyed by userId so each user
// only sees their own events. Bounded list — we keep the most recent
// 500 events per user to avoid unbounded growth on the JSON file.

// Belt-and-braces: even though migrateSchema() runs on boot, defend
// the table here so a hot-reload or programmatic db.data reassignment
// can't trip the call sites with "Cannot read properties of undefined
// (reading 'unshift')" again.
const ensureWebhookEventsArray = () => {
  if (!Array.isArray(db.data.webhookEvents)) db.data.webhookEvents = [];
};

export const webhookEvents = {
  list(userId, integration, limit = 100) {
    ensureWebhookEventsArray();
    return db.data.webhookEvents
      .filter(e => e.userId === userId && (!integration || e.integration === integration))
      .slice(0, limit);
  },
  async record({ userId, integration, headers, body, ip }) {
    ensureWebhookEventsArray();
    const event = {
      id: nextId('webhook'),
      userId,
      integration,
      receivedAt: new Date().toISOString(),
      headers: headers ? JSON.stringify(headers).slice(0, 4000) : null,
      body: body ? JSON.stringify(body).slice(0, 20000) : null,
      ip: ip || null,
    };
    db.data.webhookEvents.unshift(event);
    // Keep at most 500 events per user across all integrations.
    const userEventCount = db.data.webhookEvents.filter(e => e.userId === userId).length;
    if (userEventCount > 500) {
      // Find indexes of this user's oldest events and drop them.
      const userEvents = db.data.webhookEvents.filter(e => e.userId === userId);
      const keep = new Set(userEvents.slice(0, 500).map(e => e.id));
      db.data.webhookEvents = db.data.webhookEvents.filter(e => e.userId !== userId || keep.has(e.id));
    }
    await persist();
    // Pairs with the "[webhook] DocuSign <type> envelope=<id>" line in
    // routes/webhooks.js. Together: one log when the event arrived,
    // one when it landed in storage.
    // eslint-disable-next-line no-console
    console.log(`[webhook] saved event-id=${event.id} integration=${integration}`);
    return event;
  },
  async clear(userId, integration) {
    ensureWebhookEventsArray();
    const before = db.data.webhookEvents.length;
    db.data.webhookEvents = db.data.webhookEvents.filter(e => !(e.userId === userId && (!integration || e.integration === integration)));
    if (db.data.webhookEvents.length !== before) await persist();
    return before - db.data.webhookEvents.length;
  },
};

// ----- Sessions ---------------------------------------------------------
// Custom express-session store backed by lowdb. Implements the standard
// store interface (get/set/destroy/touch).

export class LowdbSessionStore extends session.Store {
  constructor() {
    super();
    // Sweep expired sessions every minute.
    this.sweepHandle = setInterval(() => this._sweep().catch(() => {}), 60 * 1000);
    this.sweepHandle.unref?.();
  }
  async _sweep() {
    if (!db || !db.data) return;
    const now = Date.now();
    const before = db.data.sessions.length;
    db.data.sessions = db.data.sessions.filter(s => s.expires > now);
    if (db.data.sessions.length !== before) await persist();
  }
  get(sid, cb) {
    try {
      const row = db.data.sessions.find(s => s.sid === sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        // Don't await — fire & forget; the sweep will clean up.
        this.destroy(sid, () => {});
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) { cb(err); }
  }
  set(sid, sess, cb) {
    (async () => {
      try {
        const expires = sess.cookie?.expires
          ? new Date(sess.cookie.expires).getTime()
          : Date.now() + 7 * 24 * 60 * 60 * 1000;
        let row = db.data.sessions.find(s => s.sid === sid);
        if (row) {
          row.sess = JSON.stringify(sess);
          row.expires = expires;
        } else {
          db.data.sessions.push({ sid, sess: JSON.stringify(sess), expires });
        }
        await persist();
        cb && cb(null);
      } catch (err) { cb && cb(err); }
    })();
  }
  destroy(sid, cb) {
    (async () => {
      try {
        const before = db.data.sessions.length;
        db.data.sessions = db.data.sessions.filter(s => s.sid !== sid);
        if (db.data.sessions.length !== before) await persist();
        cb && cb(null);
      } catch (err) { cb && cb(err); }
    })();
  }
  touch(sid, sess, cb) {
    // Refresh expires without rewriting the whole session blob.
    (async () => {
      try {
        const row = db.data.sessions.find(s => s.sid === sid);
        if (row) {
          row.expires = sess.cookie?.expires
            ? new Date(sess.cookie.expires).getTime()
            : Date.now() + 7 * 24 * 60 * 60 * 1000;
          await persist();
        }
        cb && cb(null);
      } catch (err) { cb && cb(err); }
    })();
  }
}
