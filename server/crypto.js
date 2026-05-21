// ============================================================
// At-rest encryption for integration secrets.
//
// Uses AES-256-GCM with a master key loaded from ENCRYPTION_KEY env var.
// Each encrypted value gets its own random 12-byte IV. GCM auth tag is
// stored alongside so decryption fails loudly if the ciphertext is
// tampered with. Plaintext NEVER touches disk.
//
// SAFETY: losing ENCRYPTION_KEY makes all stored secrets unrecoverable.
// Back the key up in a password manager / KMS out-of-band.
// ============================================================
import crypto from 'node:crypto';

const KEY_B64 = process.env.ENCRYPTION_KEY;
if (!KEY_B64) {
  // Don't crash here — server.js handles env-validation up-front. But
  // any attempt to call encrypt() before the env is set will throw.
  // eslint-disable-next-line no-console
  console.warn('[crypto] ENCRYPTION_KEY not set — secrets API will refuse to encrypt.');
}

const getKey = () => {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY env var is required to read/write secrets.');
  }
  const buf = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
  if (buf.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to exactly 32 bytes; got ${buf.length}.`);
  }
  return buf;
};

export const encrypt = (plaintext) => {
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM standard nonce size
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
};

export const decrypt = ({ ciphertext, iv, authTag }) => {
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
};

// Constant-time string comparison for CSRF tokens etc.
export const timingSafeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

// Cryptographically random URL-safe token.
export const randomToken = (bytes = 32) =>
  crypto.randomBytes(bytes).toString('base64url');

// Last-4 of a secret for UI display (e.g. "•••• abc1"). We never store
// the plaintext, so this is computed once at the moment of save and
// returned to the client; on later GETs we re-derive from the same row's
// metadata if available.
export const lastChars = (s, n = 4) => {
  if (!s) return '';
  return String(s).slice(-n);
};
