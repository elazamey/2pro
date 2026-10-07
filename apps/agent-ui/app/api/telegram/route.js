import { timingSafeEqual } from "node:crypto";
import { sendTelegramMessage } from "@2pro/notifications";
import { callCeliaAgent } from "../../../lib/celia-agent.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recentUpdates = new Map();
const UPDATE_TTL_MS = 15 * 60 * 1000;

function jsonError(message, status) {
  return Response.json({ ok: false, error: message }, { status });
}

function configuredChatIds() {
  const raw = [
    process.env.TELEGRAM_ALLOWED_CHAT_IDS || "",
    process.env.TELEGRAM_ADMIN_CHAT_ID || "",
  ].join(",");
  return new Set(raw.split(",").map((id) => id.trim()).filter(Boolean));
}

function secretMatches(actual, expected) {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

function parseTelegramCommand(text) {
  const firstWord = text.trim().split(/\s+/, 1)[0] || "";
  return firstWord.split("@")[0].toLowerCase();
}

function rememberUpdate(updateId) {
  const now = Date.now();
  for (const [id, createdAt] of recentUpdates) {
    if (now - createdAt > UPDATE_TTL_MS) recentUpdates.delete(id);
  }
  if (recentUpdates.has(updateId)) return false;
  recentUpdates.set(updateId, now);
  if (recentUpdates.size > 2_000) {
    const oldest = recentUpdates.keys().next().value;
    if (oldest !== undefined) recentUpdates.delete(oldest);
  }
  return true;
}

async function collectAgentReply(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";

  function readFrame(frame) {
    let eventName = "message";
    const dataLines = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim() || "message";
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    if (raw === "[DONE]") return;
    let data;
    try { data = JSON.parse(raw); } catch { data = { text: raw }; }
    const type = data?.type || eventName;
    if (type === "error") throw new Error(String(data?.error || data?.message || "تعذّر إكمال الطلب."));
    if (type === "reply") {
      if (typeof data?.delta === "string") reply += data.delta;
      else if (typeof data?.text === "string") reply = data.text;
      else if (typeof data?.reply === "string") reply = data.reply;
    }
    if (type === "done" && typeof data?.reply === "string") reply = data.reply;
  }

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) readFrame(frame);
    if (done) break;
  }
  if (buffer.trim()) readFrame(buffer);
  return reply.trim();
}

function buildAgentPrompt(text, command) {
  if (command === "/deploy") {
    const detail = text.trim().replace(/^\/deploy(?:@\w+)?\s*/i, "");
    return `جهّز خطة نشر للمشروع${detail ? ` مع هذه التفاصيل: ${detail}` : ""}. افحص الحالة وقدّم الخطوات والنتيجة المتوقعة، ولا تنفّذ النشر أو أي إجراء خارجي قبل الحصول على تأكيد صريح من المستخدم.`;
  }
  return text;
}

export async function GET() {
  const username = (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  const botUrl = /^[A-Za-z0-9_]{5,32}$/.test(username) ? `https://t.me/${username}` : null;
  return Response.json({
    ready: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET && botUrl),
    botUrl,
  });
}

export async function POST(request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!botToken || !webhookSecret) return jsonError("إعداد Webhook غير مكتمل.", 503);
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), webhookSecret)) {
    return jsonError("طلب Webhook غير موثّق.", 401);
  }
  if (Number(request.headers.get("content-length") || 0) > 256_000) {
    return jsonError("حجم التحديث أكبر من الحد المسموح.", 413);
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return jsonError("تعذّر قراءة تحديث Telegram.", 400);
  }

  const telegramMessage = update?.message;
  const text = typeof telegramMessage?.text === "string" ? telegramMessage.text.trim() : "";
  const rawChatId = telegramMessage?.chat?.id;
  if (!text || (typeof rawChatId !== "string" && typeof rawChatId !== "number")) {
    return Response.json({ ok: true });
  }
  const chatId = String(rawChatId);
  if (!/^-?\d{1,20}$/.test(chatId) || telegramMessage?.from?.is_bot) {
    return Response.json({ ok: true });
  }

  const updateId = Number.isSafeInteger(update?.update_id) ? String(update.update_id) : "";
  if (updateId && !rememberUpdate(updateId)) return Response.json({ ok: true, duplicate: true });

  const command = parseTelegramCommand(text);
  const allowedChatIds = configuredChatIds();
  const isAllowed = allowedChatIds.has(chatId);

  try {
    if (!isAllowed) {
      if (command === "/id") {
        await sendTelegramMessage(chatId, `معرّف هذه المحادثة: ${chatId}\nأرسله لمسؤول البوت لإضافته إلى قائمة الوصول.`);
      } else if (command === "/start" || command === "/help") {
        await sendTelegramMessage(chatId, "مرحبًا! هذا بوت Celia الخاص. أرسل /id لمسؤول البوت لطلب تفعيل الوصول.");
      }
      // Acknowledge other unauthorized messages without invoking the agent.
      return Response.json({ ok: true });
    }

    if (command === "/id") {
      await sendTelegramMessage(chatId, `معرّف المحادثة المصرّح بها: ${chatId}`);
      return Response.json({ ok: true });
    }
    if (command === "/start" || command === "/help") {
      await sendTelegramMessage(chatId, "أهلًا بك في Celia Agent. أرسل طلبك كنص، أو استخدم /status لمعرفة حالة الربط و /deploy لطلب خطة نشر آمنة.");
      return Response.json({ ok: true });
    }
    if (command === "/status") {
      const agentStatus = process.env.CELIA_AGENT_URL ? "مهيّأ" : "غير موصول";
      await sendTelegramMessage(chatId, `🟢 Webhook: نشط\n🤖 Celia Agent: ${agentStatus}\n🔐 الوصول: مقيّد بقائمة السماح\nلا يتم التحقق هنا من حالة المدفوعات أو الخوادم.`);
      return Response.json({ ok: true });
    }
    if (command.startsWith("/") && command !== "/deploy") {
      await sendTelegramMessage(chatId, "أمر غير معروف. أرسل /help لعرض الأوامر المتاحة.");
      return Response.json({ ok: true });
    }
    if (text.length > 4000) {
      await sendTelegramMessage(chatId, "الرسالة طويلة جدًا. الحد الأقصى 4000 حرف.");
      return Response.json({ ok: true });
    }

    const result = await callCeliaAgent({
      message: buildAgentPrompt(text, command),
      conversationId: `telegram:${chatId}`,
      requestId: updateId ? `telegram:${updateId}` : undefined,
      history: [],
      timeoutMs: 25_000,
    });

    let replyText;
    if (result.mode === "demo") {
      replyText = "بوت Telegram متصل، لكن Celia Agent غير موصول بعد. أضف CELIA_AGENT_URL لتفعيل معالجة الطلبات. لم يتم تنفيذ أي إجراء خارجي.";
    } else if (result.stream) {
      replyText = await collectAgentReply(result.stream);
    } else {
      replyText = String(result.payload?.reply || result.payload?.response || result.payload?.message || "استلمت طلبك، لكن لم يصل رد نصي من الوكيل.");
    }

    if (replyText) await sendTelegramMessage(chatId, replyText);
    return Response.json({ ok: true });
  } catch (error) {
    if (updateId) recentUpdates.delete(updateId);
    if (error?.name === "TelegramApiError") return jsonError("تعذّر إرسال رد Telegram.", 502);

    const safeError = error?.name === "TimeoutError"
      ? "انتهت مهلة اتصال Celia Agent. حاول مجددًا بعد قليل."
      : "تعذّر إكمال الطلب عبر Celia Agent. حاول مجددًا لاحقًا.";
    try {
      await sendTelegramMessage(chatId, safeError);
      return Response.json({ ok: true });
    } catch {
      return jsonError("Webhook failed.", 502);
    }
  }
}
