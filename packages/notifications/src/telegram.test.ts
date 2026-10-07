import test from "node:test";
import assert from "node:assert/strict";
import { notifyAdminViaTelegram, sendTelegramMessage, TelegramApiError } from "./telegram.js";

function withEnvironment(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("sendTelegramMessage posts a plain-text Bot API message", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ ok: true, result: { message_id: 17 } });
  };

  const result = await sendTelegramMessage(12345, "Hello from Celia", {
    botToken: "123:secret",
    apiBaseUrl: "https://telegram.test/",
    fetchImpl,
  });

  assert.equal(requestUrl, "https://telegram.test/bot123:secret/sendMessage");
  assert.deepEqual(requestBody, {
    chat_id: 12345,
    text: "Hello from Celia",
    disable_web_page_preview: true,
  });
  assert.deepEqual(result, { message_id: 17 });
});

test("sendTelegramMessage surfaces Telegram API errors", async () => {
  const fetchImpl: typeof fetch = async () => Response.json(
    { ok: false, description: "chat not found" },
    { status: 400 },
  );

  await assert.rejects(
    sendTelegramMessage(10, "Hello", { botToken: "token", fetchImpl }),
    (error: unknown) => error instanceof TelegramApiError && error.message === "chat not found" && error.status === 400,
  );
});

test("notifyAdminViaTelegram is a no-op until bot and admin chat are configured", () => withEnvironment(
  { TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_ADMIN_CHAT_ID: undefined },
  async () => {
    assert.equal(await notifyAdminViaTelegram("Deployment complete"), false);
  },
));
