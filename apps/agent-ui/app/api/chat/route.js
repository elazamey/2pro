import { callCeliaAgent } from "../../../lib/celia-agent.js";

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
  if (body?.learningConsent !== undefined && typeof body.learningConsent !== "boolean") {
    return jsonError("حقل موافقة التعلّم يجب أن يكون قيمة منطقية.", 400);
  }
  const learningConsent = body?.learningConsent === true;

  const conversationId = typeof body.conversationId === "string" && body.conversationId.length <= 160
    ? body.conversationId
    : undefined;
  const history = Array.isArray(body.history)
    ? body.history.slice(-20).flatMap((item) => {
      if (!["user", "assistant"].includes(item?.role) || typeof item?.content !== "string") return [];
      return [{ role: item.role, content: item.content.slice(0, 4000) }];
    })
    : [];

  try {
    const result = await callCeliaAgent({ message, conversationId, history, learningConsent });
    if (result.mode === "demo") {
      // The browser turns this response into an explicitly-labelled local demo.
      // No external tools are called and no project files are changed in demo mode.
      return Response.json({ mode: "demo" });
    }

    if (result.stream) {
      return new Response(result.stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }

    return Response.json({ ...result.payload, mode: "live" });
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? "انتهت مهلة الاتصال بخدمة الوكيل."
      : error?.message || "تعذّر الاتصال بخدمة Celia Agent.";
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return jsonError(String(message).slice(0, 500), status);
  }
}
