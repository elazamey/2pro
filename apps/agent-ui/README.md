# @2pro/agent-ui — Celia Agent workspace

A responsive Next.js 16 chat workspace for Celia Agent. The interface is Arabic-first (RTL), dark-mode by default, and includes a high-level live execution timeline, suggested prompts, and follow-up action buttons.

## Run locally

From the repository root:

```bash
npm install
npm run dev:agent-ui
```

Open <http://localhost:3001> or <http://localhost:3001/chat>. Without `CELIA_AGENT_URL`, the app runs in **demo mode**. The simulated progress and assistant response are explicitly labelled; no code is changed and no Vercel, payment, WhatsApp, or MCP action is performed.

## Telegram webhook (MVP)

The existing `apps/dashboard` is an Express app; the Celia Next.js application is `apps/agent-ui`. Its server-side Telegram route is `POST /api/telegram`.

1. Create a bot with `@BotFather`; copy `.env.example` to `.env.local` and set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and a strong `TELEGRAM_WEBHOOK_SECRET` (for example, `openssl rand -hex 32`).
2. Add your numeric Telegram chat ID to `TELEGRAM_ALLOWED_CHAT_IDS`. `TELEGRAM_ADMIN_CHAT_ID` is also included in the allowlist and is used by the admin notification helper.
3. Run the app with `npm run dev:agent-ui` (port 3001), expose port 3001 over an HTTPS ngrok/Cloudflare Tunnel, then set `TELEGRAM_WEBHOOK_URL=https://<tunnel-host>/api/telegram`.
4. Run `npm run telegram:setup -w @2pro/agent-ui`. The script loads `.env.local`, verifies the bot with `getMe`, and registers the webhook with `setWebhook` and the configured secret token. It configures Telegram only; it does not install or start the tunnel.

The route verifies `X-Telegram-Bot-Api-Secret-Token` in constant time, ignores non-text updates, and only forwards allowlisted chats to Celia. Supported commands are `/start`, `/help`, `/id`, `/status`, and `/deploy`; `/deploy` asks the agent for a plan and explicitly instructs it not to deploy until the user confirms. If `CELIA_AGENT_URL` is unset, Telegram replies that the agent is not connected rather than pretending an operation happened. Telegram update IDs are forwarded as `requestId` for downstream idempotency, with an additional in-memory duplicate guard. Both are best-effort without a durable store; add a persistent queue/idempotency store before relying on paid or destructive operations.

The bot link appears beside the web chat's quick actions when `TELEGRAM_BOT_USERNAME` is set. The webhook secret, bot token, and agent token are never sent to the browser.

## Task and execution contract (v1 draft)

The task/project and versioned SSE contract is documented in [`contracts/agent-platform-v1.md`](./contracts/agent-platform-v1.md). The companion [`contracts/learning-memory-v1.md`](./contracts/learning-memory-v1.md) defines versioned Memory, Knowledge, Learning, Evaluation, Experiment, Skill, approval, retention, and forgetting contracts, with a machine-readable [JSON Schema](./contracts/learning-memory-v1.schema.json). The UI validates and consumes task-scoped cognitive events while preserving legacy chat events. `lib/workspace-event-bus.mjs` is a bounded, process-local event bus with scope sequencing, cursor replay, subscribers, and SSE framing; it is a testable R1 component, not a durable service. It is not connected to an HTTP route, workspace UI subscription, authorization gateway, or outbox. This remains a protocol foundation: there is no persistent memory/knowledge API, task/project API, evaluator, sandbox, tool router, artifact storage, or approval service yet.

## Connect Celia Agent

Configure these variables in the Next.js server environment (never expose the token as a `NEXT_PUBLIC_*` variable):

```bash
CELIA_AGENT_URL=https://your-agent.example.com/api/chat
CELIA_AGENT_TOKEN=... # optional Bearer token
```

The app's `/api/chat` route validates and bounds the request, proxies it server-to-server, and attaches the optional bearer token. Conversation history is kept in browser memory and sent with the latest request; it is not persisted by this UI. The upstream service should accept:

```json
{
  "message": "...",
  "conversationId": "optional",
  "requestId": "optional idempotency key",
  "learningConsent": false,
  "history": [{ "role": "user", "content": "..." }]
}
```

It should return JSON in this shape:

```json
{
  "reply": "A user-facing response",
  "steps": [
    {
      "id": "prepare",
      "title": "Prepare deployment files",
      "description": "Check project and deployment settings",
      "status": "running",
      "icon": "rocket"
    }
  ],
  "actions": [
    {
      "id": "payments",
      "label": "Review payment setup",
      "prompt": "Prepare the payment setup and ask before enabling it",
      "icon": "creditCard",
      "tone": "violet"
    }
  ]
}
```

Step statuses accepted by the UI are `pending`, `running`, `done`, and `error`. For live progress, the endpoint may return `Content-Type: text/event-stream`. The UI accepts these events, each with JSON in its `data:` line:

```text
event: steps
data: {"steps":[...]}

event: step
data: {"step":{"id":"deploy","title":"Deploy","status":"running"}}

event: reply
data: {"delta":"Deployment is starting…"}

event: actions
data: {"actions":[...]}

event: done
data: {"reply":"Deployment complete","steps":[...],"actions":[...],"conversationId":"..."}
```

`learningConsent` is an explicit per-task opt-in, defaults to `false`, is validated by `/api/chat`, and is forwarded server-to-server. The connected agent must honor it before recording a sanitized experience; it is not proof that the upstream implements persistence or learning. In demo mode no experience is sent or retained. The `/api/chat` route streams event responses through without exposing the upstream bearer token. Actions are follow-up prompts sent back to the agent, not direct browser-side integrations. The agent service must enforce authorization and ask for confirmation before consequential external actions. This first frontend slice does not include user sign-in or durable rate limiting; do not expose a privileged agent endpoint publicly until access control and abuse limits are enforced by the agent service or an authenticated gateway. The proxy only adds a server-side bearer token and is not user authentication.

The existing repository's [`mcp.json`](../../mcp.json) launches local stdio MCP servers (Figma/Google); it is not an HTTP agent endpoint. A hosted Celia Agent service must connect to MCP tools server-side and return safe, user-facing progress to this UI. The timeline is deliberately limited to operational steps and does not expose private model reasoning.

## Deploy

For the simplest Next.js deployment, create a Vercel project with **Root Directory** set to `apps/agent-ui`, then add the server environment variables above. Deployment and free-tier availability are governed by the host's current plan and limits. Cloudflare may also be used with its supported Next.js/OpenNext adapter; verify both the app routes and the agent proxy in that runtime before switching production traffic.
