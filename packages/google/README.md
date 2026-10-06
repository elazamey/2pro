# @2pro/google

TypeScript client for Google Workspace (**Drive** + **Gmail**) built on the
official `googleapis` SDK, with OAuth 2.0 helpers for CLI and web flows.

## Features

- **Drive**: list, search, get, upload (simple/multipart/resumable), create folders, delete.
- **Gmail**: list messages, get full message (decoded plain-text/HTML bodies + parsed From/To/Cc), send (plain + multipart HTML), create drafts, mark read, trash, list labels, unread count.
- **OAuth 2.0** helpers: build authorize URL, exchange code for tokens, create pre-authed `OAuth2Client`.
- **Token store** (`fileTokenStore`) for saving refresh tokens in `~/.config/2pro/google-tokens.json`.
- CLI: `2pro google login|status|logout`, `2pro drive list|search|upload|mkdir`, `2pro gmail list|show|send|unread`.
- Dashboard tab with OAuth connect button, Gmail inbox preview, Drive search.

## CLI auth flow

```bash
export GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=yyy

2pro google login        # opens localhost:42735 for OAuth callback
2pro drive list
2pro drive upload ./report.pdf --name "Q3 Report.pdf" --folder <folder-id>
2pro gmail list --unread
2pro gmail send --to alice@example.com --subject "Hi" --body "Hello!" --html ./email.html
```

## Web flow (dashboard)

The dashboard exposes `/auth/google/login`, `/auth/google/callback`,
`/auth/google/logout`, `/auth/google/status` and JSON APIs under
`/api/drive/*` and `/api/gmail/*`. Credentials are encrypted in the session
cookie along with the GitHub tokens.

## Required Google Cloud setup

1. Create a project at <https://console.cloud.google.com/>.
2. Enable **Google Drive API** and **Gmail API**.
3. Create an **OAuth 2.0 Client ID**:
   - For CLI: **Desktop app** (redirect URI `http://localhost:42735/callback`).
   - For web dashboard: **Web application** (add your domain + `/auth/google/callback`).
4. Export `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
