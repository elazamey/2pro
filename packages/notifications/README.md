# @2pro/notifications

Zero-dependency helpers for sending Telegram Bot API messages and optional operator alerts from server-side code.

## Install / build

This package is a monorepo workspace:

```bash
npm install
npm run build -w @2pro/notifications
npm test -w @2pro/notifications
```

## Send a message

```ts
import { sendTelegramMessage } from "@2pro/notifications";

await sendTelegramMessage("123456789", "Your deployment finished successfully.");
```

`sendTelegramMessage(chatId, text, options?)` reads `TELEGRAM_BOT_TOKEN` from the environment by default. It sends plain text (no Markdown parsing), limits messages to Telegram's 4096-character limit, applies a 10-second timeout, and throws `TelegramApiError` if the request fails. A token, API base URL, timeout, and `fetch` implementation can be passed in options for tests or controlled proxies.

## Admin alerts

```ts
import { notifyAdminViaTelegram } from "@2pro/notifications";

const sent = await notifyAdminViaTelegram("A payment succeeded.");
if (!sent) console.info("Telegram admin alerts are not configured.");
```

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`. The function returns `false` when either variable is missing; Telegram delivery errors still throw. Call it from server-side event handlers after verifying payment/deployment/anchor events. The repository currently does not include Stripe/USDT, Vercel/Cloudflare deployment, or blockchain-anchor event producers, so event hooks must be added in those systems before these alerts can represent real events.

Keep bot credentials out of `NEXT_PUBLIC_*` variables and client code.
