import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadLocalEnvironment() {
  try {
    const file = await readFile(path.join(appDir, ".env.local"), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) continue;
      process.env[key] = unquote(trimmed.slice(separator + 1));
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function telegramApi(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    throw new Error(result?.description || `Telegram ${method} failed with HTTP ${response.status}.`);
  }
  return result.result;
}

await loadLocalEnvironment();
const token = process.env.TELEGRAM_BOT_TOKEN;
const rawUrl = process.env.TELEGRAM_WEBHOOK_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN in apps/agent-ui/.env.local or your shell.");
if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  throw new Error("Set TELEGRAM_WEBHOOK_SECRET to 1–256 letters, digits, underscores, or hyphens.");
}
if (!rawUrl) throw new Error("Set TELEGRAM_WEBHOOK_URL to your public HTTPS URL ending in /api/telegram.");

const webhookUrl = new URL(rawUrl);
if (
  webhookUrl.protocol !== "https:" ||
  !webhookUrl.pathname.replace(/\/+$/, "").endsWith("/api/telegram") ||
  webhookUrl.search ||
  webhookUrl.hash
) {
  throw new Error("TELEGRAM_WEBHOOK_URL must be HTTPS, have no query/fragment, and end with /api/telegram (use an HTTPS tunnel for local development).");
}
webhookUrl.pathname = webhookUrl.pathname.replace(/\/+$/, "");

const bot = await telegramApi(token, "getMe", {});
await telegramApi(token, "setWebhook", {
  url: webhookUrl.toString(),
  secret_token: secret,
  allowed_updates: ["message"],
  drop_pending_updates: false,
});
const webhookInfo = await telegramApi(token, "getWebhookInfo", {});

console.log(`Webhook configured for @${bot.username || "your bot"}.`);
console.log(`Webhook URL: ${webhookInfo.url || webhookUrl.toString()}`);
console.log(`Pending updates: ${webhookInfo.pending_update_count ?? 0}`);
console.log("Add your Telegram chat ID to TELEGRAM_ALLOWED_CHAT_IDS before sending agent commands.");
