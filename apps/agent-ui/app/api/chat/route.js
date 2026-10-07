export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  return Response.json({ mode: process.env.CELIA_AGENT_URL ? "live" : "demo" });
}

export async function POST(request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return jsonError("الطلب مرفوض.", 403);
  }
  if (Number(request.headers.get("content-length") || 0) > 256_000) {
    return jsonError("حجم الطلب أكبر من الحد المسموح.", 413);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonError("يجب إرسال الطلب بصيغة JSON.", 415);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("تعذّر قراءة الطلب.", 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return jsonError("اكتب طلبًا أولًا.", 400);
  if (message.length > 4000) return jsonError("الطلب أطول من الحد المسموح.", 413);

  const conversationId = typeof body.conversationId === "string" && body.conversationId.length <= 160
    ? body.conversationId
    : undefined;
  const history = Array.isArray(body.history)
    ? body.history.slice(-20).flatMap((item) => {
      if (!["user", "assistant"].includes(item?.role) || typeof item?.content !== "string") return [];
      return [{ role: item.role, content: item.content.slice(0, 4000) }];
    })
    : [];

  const agentUrl = process.env.CELIA_AGENT_URL;
  if (!agentUrl) {
    // The browser turns this response into an explicitly-labelled local demo.
    // No external tools are called and no project files are changed in demo mode.
    return Response.json({ mode: "demo" });
  }

  try {
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (process.env.CELIA_AGENT_TOKEN) {
      headers.Authorization = `Bearer ${process.env.CELIA_AGENT_TOKEN}`;
    }

    const upstream = await fetch(agentUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, conversationId, history }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (upstream.ok && contentType.includes("text/event-stream") && upstream.body) {
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }
    const payload = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const message = typeof payload?.error === "string" ? payload.error : `خدمة الوكيل أعادت الحالة ${upstream.status}.`;
      return jsonError(message.slice(0, 500), upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return jsonError("استجابة الوكيل ليست بتنسيق JSON المتوقع.", 502);
    }

    return Response.json({ ...payload, mode: "live" });
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? "انتهت مهلة الاتصال بخدمة الوكيل."
      : "تعذّر الاتصال بخدمة Celia Agent.";
    return jsonError(message, 502);
  }
}
