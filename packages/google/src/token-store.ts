/**
 * A tiny, file-system-backed token store for CLI usage. Stores per-account
 * OAuth credentials under ~/.config/2pro/google-tokens.json.
 *
 * For the web dashboard, use the encrypted cookie session (see apps/dashboard/session.js).
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SavedCredentials } from "./auth.js";

function defaultPath(): string {
  return join(homedir(), ".config", "2pro", "google-tokens.json");
}

export interface TokenStore {
  load(account?: string): Promise<SavedCredentials | null>;
  save(creds: SavedCredentials, account?: string): Promise<void>;
  clear(account?: string): Promise<void>;
  path: string;
}

export function fileTokenStore(path: string = defaultPath()): TokenStore {
  return {
    path,
    async load(account = "default"): Promise<SavedCredentials | null> {
      try {
        const raw = await fs.readFile(path, "utf8");
        const all = JSON.parse(raw) as Record<string, SavedCredentials>;
        return all[account] ?? null;
      } catch {
        return null;
      }
    },
    async save(creds: SavedCredentials, account = "default"): Promise<void> {
      let all: Record<string, SavedCredentials> = {};
      try {
        const raw = await fs.readFile(path, "utf8");
        all = JSON.parse(raw);
      } catch { /* new file */ }
      all[account] = creds;
      await fs.mkdir(join(path, ".."), { recursive: true });
      await fs.writeFile(path, JSON.stringify(all, null, 2), { mode: 0o600 });
    },
    async clear(account = "default"): Promise<void> {
      let all: Record<string, SavedCredentials> = {};
      try {
        const raw = await fs.readFile(path, "utf8");
        all = JSON.parse(raw);
      } catch { return; }
      delete all[account];
      await fs.writeFile(path, JSON.stringify(all, null, 2), { mode: 0o600 });
    },
  };
}
