import { createOAuth2Client, type GoogleClientConfig, type SavedCredentials } from "./auth.js";
import { Drive } from "./drive.js";
import { Gmail } from "./gmail.js";

/**
 * Unified Google Workspace client bundling Drive + Gmail with shared OAuth.
 */
export class GoogleClient {
  readonly drive: Drive;
  readonly gmail: Gmail;
  readonly oauth2: ReturnType<typeof createOAuth2Client>;

  constructor(
    config: GoogleClientConfig,
    credentials?: SavedCredentials | null,
  ) {
    this.oauth2 = createOAuth2Client(config, credentials);
    this.drive = new Drive(this.oauth2);
    this.gmail = new Gmail(this.oauth2);
  }

  /** Check if the client has usable credentials (access token or a refreshable one). */
  hasCredentials(): boolean {
    const creds = this.oauth2.credentials;
    return Boolean(creds && (creds.access_token || creds.refresh_token));
  }

  /** Return current credentials (access token, refresh token, expiry). */
  getCredentials(): SavedCredentials {
    return (this.oauth2.credentials ?? {}) as SavedCredentials;
  }

  /** Manually set/replace credentials (e.g. after refresh). */
  setCredentials(creds: SavedCredentials) {
    this.oauth2.setCredentials(creds);
  }
}
