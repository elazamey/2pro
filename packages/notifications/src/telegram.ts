export interface TelegramSendOptions {
  /** Bot token. Defaults to TELEGRAM_BOT_TOKEN. */
  botToken?: string;
  /** Telegram API base URL; override for tests or a compatible proxy. */
  apiBaseUrl?: string;
  /** Request deadline in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Injectable fetch implementation, primarily for tests. */
  fetchImpl?: typeof fetch;
}

export class TelegramApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.status = status;
  }
}

function resolveToken(options: TelegramSendOptions): string {
  const token = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramApiError("Set TELEGRAM_BOT_TOKEN to send Telegram messages.");
  return token;
}

/** Send a plain-text message through the Telegram Bot API. */
export async function sendTelegramMessage(
  chatId: string | number,
  message: string,
  options: TelegramSendOptions = {},
): Promise<unknown> {
  const token = resolveToken(options);
  const text = String(message ?? "").trim();
  if (!text) throw new TelegramApiError("Telegram message must not be empty.");

  const baseUrl = (options.apiBaseUrl || "https://api.telegram.org").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let response: Response;

  try {
    response = await fetchImpl(`${baseUrl}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: Array.from(text).slice(0, 4096).join(""),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Telegram sendMessage timed out."
      : "Unable to reach the Telegram Bot API.";
    throw new TelegramApiError(message);
  }

  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    description?: string;
    result?: unknown;
  } | null;

  if (!response.ok || payload?.ok !== true) {
    const description = typeof payload?.description === "string"
      ? payload.description.slice(0, 300)
      : `Telegram API returned HTTP ${response.status}.`;
    throw new TelegramApiError(description, response.status);
  }

  return payload.result;
}

/**
 * Send an operator alert. Returns false when notifications are not configured,
 * so payment/deployment flows can treat Telegram as an optional channel.
 */
export async function notifyAdminViaTelegram(message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return false;

  await sendTelegramMessage(chatId, `🔔 Celia System Alert\n\n${message}`, { botToken: token });
  return true;
}
