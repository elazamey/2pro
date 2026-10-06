/**
 * @2pro/google — Google Workspace client (Drive + Gmail) for 2pro.
 */

export { GoogleClient } from "./client.js";

export {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  createOAuth2Client,
  scopes,
  DRIVE_READONLY,
  DRIVE_FILE,
  DRIVE_FULL,
  GMAIL_SEND,
  GMAIL_READONLY,
  GMAIL_MODIFY,
  GMAIL_FULL,
  type GoogleClientConfig,
  type SavedCredentials,
} from "./auth.js";

export { Drive, type DriveFile, type DriveListOptions, type DriveListResult, type UploadOptions } from "./drive.js";
export {
  Gmail,
  type GmailMessageSummary,
  type GmailMessage,
  type GmailListOptions,
  type GmailListResult,
  type GmailLabel,
  type SendOptions,
} from "./gmail.js";
export { fileTokenStore, type TokenStore } from "./token-store.js";
