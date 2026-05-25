// ============================================================
// DocuSign Connect webhook HMAC verification.
//
// DocuSign signs each Connect payload with HMAC-SHA256 of the
// raw body (NOT the parsed JSON — even key ordering matters)
// and ships the result base64-encoded in X-DocuSign-Signature-N
// headers (multiple if more than one HMAC key is configured on
// the Connect listener). We accept the message if ANY of them
// match. timingSafeEqual is used so we don't leak match-length
// via response timing.
// ============================================================
import crypto from 'node:crypto';

// Compute HMAC-SHA256(secret, rawBody) → base64.
const computeHmac = (secret, rawBody) =>
  crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

// Constant-time string compare of two base64 strings. Padding to
// the longer length avoids the early-exit length check that would
// itself be a timing leak on length-mismatched inputs.
const safeEqual = (a, b) => {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still consume time so callers can't distinguish mismatched
    // lengths from mismatched contents.
    const dummy = Buffer.alloc(Math.max(ab.length, bb.length));
    crypto.timingSafeEqual(dummy, dummy);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
};

// signatureHeader is the value of X-DocuSign-Signature-1 (or
// whichever key was used). For multi-key configurations the
// caller can pass an array.
export const verifyDocusignHmac = (rawBody, signatureHeader, secret = process.env.DOCUSIGN_WEBHOOK_SECRET) => {
  if (!secret) return false;
  if (!rawBody) return false;
  // Accept Buffer (preferred) or string.
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = computeHmac(secret, body);
  const candidates = Array.isArray(signatureHeader)
    ? signatureHeader.filter(Boolean).map(String)
    : signatureHeader ? [String(signatureHeader)] : [];
  if (!candidates.length) return false;
  // Returns true if ANY provided signature matches.
  let ok = false;
  for (const cand of candidates) {
    if (safeEqual(cand, expected)) ok = true;
  }
  return ok;
};
