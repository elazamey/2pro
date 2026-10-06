/**
 * OAuth 2.0 helpers for Google APIs (Drive, Gmail, etc.).
 *
 * Supports two flows:
 *
 * 1. **Installed/CLI flow** — exchange a code for tokens (and auto-refresh)
 *    using `exchangeCodeForTokens`, then persist the returned credentials
 *    (access_token + refresh_token + expiry) wherever you like.
 *
 * 2. **Web server flow** — build an authorize URL with a CSRF `state`, then
 *    call `exchangeCodeForTokens` from the callback.
 *
 * Tokens can be used to construct an authenticated `GoogleClient`, and
 * refresh-token rotation is handled automatically by google-auth-library.
 */
import { google } from "googleapis";

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface SavedCredentials {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
  token_type?: string;
  id_token?: string | null;
}

export const DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_FULL = "https://www.googleapis.com/auth/drive";
export const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_FULL = "https://www.googleapis.com/auth/gmail.compose";

/** Combine scopes into a space-separated string (Google's format). */
export function scopes(...parts: string[]): string {
  return parts.join(" ");
}

export function buildAuthorizeUrl(opts: GoogleClientConfig & {
  state: string;
  scopes: string[] | string;
  accessType?: "offline" | "online";
  prompt?: "consent" | "none" | "select_account";
  loginHint?: string;
  includeGrantedScopes?: boolean;
}): string {
  const oauth = new google.auth.OAuth2(opts.clientId, opts.clientSecret, opts.redirectUri);
  return oauth.generateAuthUrl({
    access_type: opts.accessType ?? "offline",
    scope: typeof opts.scopes === "string" ? opts.scopes : opts.scopes,
    state: opts.state,
    prompt: opts.prompt,
    login_hint: opts.loginHint,
    include_granted_scopes: opts.includeGrantedScopes,
  });
}

export async function exchangeCodeForTokens(
  opts: GoogleClientConfig & { code: string },
): Promise<SavedCredentials> {
  const oauth = new google.auth.OAuth2(opts.clientId, opts.clientSecret, opts.redirectUri);
  const { tokens } = await oauth.getToken(opts.code);
  return tokens as SavedCredentials;
}

export function createOAuth2Client(
  opts: GoogleClientConfig,
  credentials?: SavedCredentials | null,
) {
  const oauth2 = new google.auth.OAuth2(opts.clientId, opts.clientSecret, opts.redirectUri);
  if (credentials) oauth2.setCredentials(credentials);
  return oauth2;
}
