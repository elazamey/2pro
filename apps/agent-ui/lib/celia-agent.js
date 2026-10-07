export class CeliaAgentError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "CeliaAgentError";
    this.status = status;
  }
}

/**
 * Shared server-side adapter used by the web chat and Telegram webhook.
 * CELIA_AGENT_TOKEN is deliberately kept on the server and never forwarded
 * to browser clients.
 */
export async function callCeliaAgent({ message, conversationId, history = [], requestId, learningConsent = false, timeoutMs = 60_000 }) {
  const agentUrl = process.env.CELIA_AGENT_URL;
  if (!agentUrl) return { mode: "demo" };

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (process.env.CELIA_AGENT_TOKEN) {
    headers.Authorization = `Bearer ${process.env.CELIA_AGENT_TOKEN}`;
  }

  const upstream = await fetch(agentUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, conversationId, history, requestId, learningConsent: learningConsent === true }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = upstream.headers.get("content-type") || "";

  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => null);
    const errorMessage = typeof payload?.error === "string"
      ? payload.error
      : `خدمة الوكيل أعادت الحالة ${upstream.status}.`;
    const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
    throw new CeliaAgentError(errorMessage.slice(0, 500), status);
  }

  if (contentType.toLowerCase().includes("text/event-stream") && upstream.body) {
    return { mode: "live", stream: upstream.body };
  }

  const payload = await upstream.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CeliaAgentError("استجابة الوكيل ليست بتنسيق JSON المتوقع.", 502);
  }
  return { mode: "live", payload };
}
