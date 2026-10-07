# @2pro/agent-ui — Celia Agent workspace

A responsive Next.js 16 chat workspace for Celia Agent. The interface is Arabic-first (RTL), dark-mode by default, and includes a high-level live execution timeline, suggested prompts, and follow-up action buttons.

## Run locally

From the repository root:

```bash
npm install
npm run dev:agent-ui
```

Open <http://localhost:3001>. Without `CELIA_AGENT_URL`, the app runs in **demo mode**. The simulated progress and assistant response are explicitly labelled; no code is changed and no Vercel, payment, WhatsApp, or MCP action is performed.

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

The `/api/chat` route streams event responses through without exposing the upstream bearer token. Actions are follow-up prompts sent back to the agent, not direct browser-side integrations. The agent service must enforce authorization and ask for confirmation before consequential external actions. This first frontend slice does not include user sign-in or durable rate limiting; do not expose a privileged agent endpoint publicly until access control and abuse limits are enforced by the agent service or an authenticated gateway. The proxy only adds a server-side bearer token and is not user authentication.

The existing repository's [`mcp.json`](../../mcp.json) launches local stdio MCP servers (Figma/Google); it is not an HTTP agent endpoint. A hosted Celia Agent service must connect to MCP tools server-side and return safe, user-facing progress to this UI. The timeline is deliberately limited to operational steps and does not expose private model reasoning.

## Deploy

For the simplest Next.js deployment, create a Vercel project with **Root Directory** set to `apps/agent-ui`, then add the server environment variables above. Deployment and free-tier availability are governed by the host's current plan and limits. Cloudflare may also be used with its supported Next.js/OpenNext adapter; verify both the app routes and the agent proxy in that runtime before switching production traffic.
