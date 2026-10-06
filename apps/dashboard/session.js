/**
 * Minimal, dependency-free encrypted cookie session store.
 *
 * Sessions are encrypted with AES-256-GCM using a server-side secret, and
 * stored entirely in a single HttpOnly/SameSite cookie. No DB required.
 *
 * Cookie value format: <base64(iv)>.<base64(salt)>.<base64(ciphertext)>.<base64(tag)>
 */
import crypto from "node:crypto";

const COOKIE_NAME = "2pro_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const KEY_LEN = 32;     // AES-256
const IV_LEN = 12;      // GCM recommended
const TAG_LEN = 16;
const SALT_LEN = 16;

function deriveKey(secret, salt) {
  return crypto.scryptSync(secret, salt, KEY_LEN);
}

export function createSessionMiddleware({ secret, cookieName = COOKIE_NAME, secure = false } = {}) {
  if (!secret || secret.length < 16) {
    console.warn("WARNING: SESSION_SECRET is missing or short (<16 chars). Sessions will not persist securely across restarts.");
  }

  return function sessionMiddleware(req, res, next) {
    req.session = {};

    const raw = req.cookies?.[cookieName];
    if (raw) {
      try {
        const [ivB64, saltB64, ctB64, tagB64] = raw.split(".");
        const iv = Buffer.from(ivB64, "base64");
        const salt = Buffer.from(saltB64, "base64");
        const ct = Buffer.from(ctB64, "base64");
        const tag = Buffer.from(tagB64, "base64");
        const key = deriveKey(secret, salt);
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
        req.session = JSON.parse(decrypted.toString("utf8"));
      } catch {
        // Invalid session; start fresh.
        req.session = {};
      }
    }

    res.setSession = function (data) {
      const plaintext = Buffer.from(JSON.stringify(data), "utf8");
      const salt = crypto.randomBytes(SALT_LEN);
      const iv = crypto.randomBytes(IV_LEN);
      const key = deriveKey(secret, salt);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      const value = [iv, salt, ct, tag].map(b => b.toString("base64url")).join(".");
      res.cookie(cookieName, value, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        maxAge: MAX_AGE_MS,
        path: "/",
      });
      req.session = data;
    };

    res.clearSession = function () {
      res.clearCookie(cookieName, { path: "/" });
      req.session = {};
    };

    next();
  };
}
