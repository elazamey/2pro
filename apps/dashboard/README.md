# @2pro/dashboard — GitHub Web Dashboard

A lightweight web UI for GitHub: browse your repos, manage issues & pull requests, and monitor/re-run/cancel Actions runs.

Supports two authentication modes:

1. **GitHub OAuth (recommended)** — users sign in with their own GitHub account and the dashboard uses their token.
2. **Server token (fallback)** — set `GITHUB_TOKEN` for a read-only/public dashboard, or when running locally for personal use.

## Quick start (local, server token)

```bash
export GITHUB_TOKEN=ghp_xxx
npm start           # http://localhost:3000
```

## Quick start (GitHub OAuth — production-ready)

1. Create an OAuth App at <https://github.com/settings/developers>:
   - **Homepage URL:** `http://localhost:3000` (or your production URL)
   - **Authorization callback URL:** `http://localhost:3000/auth/callback` (or `https://...`)
2. Copy `.env.example` to `.env` and fill in `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a long random `SESSION_SECRET`.
3. Run:

```bash
export GITHUB_CLIENT_ID=Iv1.xxx
export GITHUB_CLIENT_SECRET=xxx
export SESSION_SECRET=$(openssl rand -hex 32)
npm start
```

Then open <http://localhost:3000> and click **Sign in with GitHub**.

### Environment variables

| Variable               | Default               | Description                                                          |
|------------------------|-----------------------|----------------------------------------------------------------------|
| `PORT`                 | `3000`                | Listen port                                                          |
| `HOST`                 | `0.0.0.0`             | Bind address                                                         |
| `GITHUB_CLIENT_ID`     | _(unset)_             | OAuth App client ID. Enables the Sign in with GitHub flow.           |
| `GITHUB_CLIENT_SECRET` | _(unset)_             | OAuth App client secret.                                             |
| `GITHUB_SCOPES`        | `repo,read:user,read:org` | Comma-separated OAuth scopes.                                     |
| `SESSION_SECRET`       | _random at startup_   | Used to encrypt session cookies. **Set this to persist sessions across restarts in production.** |
| `FALLBACK_TOKEN` / `GITHUB_TOKEN` | _(unset)_ | Optional PAT used for non-signed-in users (read-only public mode). |
| `PUBLIC_BASE_URL`      | _(inferred)_          | Override the public base URL (e.g. `https://2pro.example.com`) used for OAuth callbacks. |

### Session storage

Sessions are stored entirely in an encrypted HttpOnly/SameSite cookie (AES-256-GCM). No database or server-side session store is required — the dashboard can run on any number of replicas behind a load balancer as long as they share the same `SESSION_SECRET`.

### Corporate proxies / custom TLS CAs

If your network intercepts TLS (common in corporate sandboxes), tell Node to trust your CA instead of disabling verification:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/proxy-ca.pem
```

The dashboard never modifies TLS settings at runtime.

## Features

- **Sign in with GitHub** button (OAuth 2.0 Web Flow with CSRF state & encrypted cookies)
- Repository grid with stars/forks/language/last-updated
- Per-repo stat summary + branch list
- Issues tab (open/closed/all, create new)
- Pull requests with merge/draft status, +/- diff counts
- Actions runs with Cancel & Re-run
- Recent commits feed

## JSON API

The server exposes a JSON API under `/api/*` that the SPA uses; it can also be consumed directly. All `/api/*` routes require a valid session (OAuth) or a fallback token.

```
GET    /auth/session             # whoami for the browser
GET    /auth/login               # redirect to GitHub OAuth
GET    /auth/callback            # OAuth callback
POST   /auth/logout              # clear session

GET    /api/me
GET    /api/repos?user=&org=&sort=&per_page=
GET    /api/repos/:owner/:repo
GET    /api/repos/:owner/:repo/branches
GET    /api/repos/:owner/:repo/commits?sha=
GET    /api/repos/:owner/:repo/issues?state=open|closed|all
POST   /api/repos/:owner/:repo/issues   { title, body?, labels?[] }
GET    /api/repos/:owner/:repo/pulls?state=...
GET    /api/repos/:owner/:repo/actions/runs?branch=
POST   /api/repos/:owner/:repo/actions/runs/:runId/rerun
POST   /api/repos/:owner/:repo/actions/runs/:runId/cancel
GET    /api/repos/:owner/:repo/actions/workflows
```
