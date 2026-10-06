import crypto from "node:crypto";
import type { EventSource, VerifyResult } from "./types.js";

/**
 * Verify a GitHub webhook using HMAC-SHA256 (X-Hub-Signature-256).
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export function verifyGitHubSignature(
  rawBody: string,
  signatureHeader: string | undefined | null,
  secret: string | undefined,
): VerifyResult {
  if (!secret) return { ok: true, reason: "no secret configured (skip verify)" };
  if (!signatureHeader) return { ok: false, reason: "missing X-Hub-Signature-256 header" };
  if (!signatureHeader.startsWith("sha256=")) return { ok: false, reason: "unsupported signature algorithm" };
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

/**
 * Verify a GitLab webhook using X-Gitlab-Token header comparison.
 * https://docs.gitlab.com/ee/user/project/integrations/webhooks.html#validate-payloads-by-using-a-secret-token
 */
export function verifyGitLabToken(
  tokenHeader: string | undefined | null,
  secret: string | undefined,
): VerifyResult {
  if (!secret) return { ok: true, reason: "no secret configured (skip verify)" };
  if (!tokenHeader) return { ok: false, reason: "missing X-Gitlab-Token header" };
  const a = Buffer.from(tokenHeader);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "token mismatch" };
  }
  return { ok: true };
}

export function verify(source: EventSource, rawBody: string, headers: Record<string, string | string[] | undefined>, secret: string | undefined): VerifyResult {
  const get = (k: string) => {
    const v = headers[k] ?? headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  if (source === "github") return verifyGitHubSignature(rawBody, get("x-hub-signature-256"), secret);
  if (source === "gitlab") return verifyGitLabToken(get("x-gitlab-token"), secret);
  return { ok: false, reason: `unsupported source: ${source}` };
}
