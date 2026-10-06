/**
 * CLI OAuth flow for Google: starts a temporary localhost server, opens a
 * browser, waits for the OAuth callback, exchanges the code, and returns
 * credentials.
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import { exchangeCodeForTokens, buildAuthorizeUrl, type GoogleClientConfig, type SavedCredentials } from "@2pro/google";

export interface CliAuthOptions {
  scopes: string[];
  clientId: string;
  clientSecret: string;
  /** Optional browser-open command override. Falls back to printing a URL. */
  open?: (url: string) => void;
  port?: number;
}

export async function cliAuthorize(opts: CliAuthOptions): Promise<SavedCredentials> {
  const port = opts.port ?? 42735;
  const redirectUri = `http://localhost:${port}/callback`;
  const cfg: GoogleClientConfig & { code?: string } = {
    clientId: opts.clientId, clientSecret: opts.clientSecret, redirectUri,
  };
  return new Promise((resolve, reject) => {
    const state = randomBytes(16).toString("hex");
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", "http://localhost");
        if (url.pathname !== "/callback") {
          res.writeHead(404); res.end("Not found"); return;
        }
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        if (error) { res.writeHead(400); res.end(`OAuth error: ${error}`); server.close(); reject(new Error(error)); return; }
        if (!code || returnedState !== state) {
          res.writeHead(400); res.end("Invalid callback"); server.close(); reject(new Error("Invalid callback")); return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!doctype html><meta charset=utf-8><title>2pro</title><div style="font-family:sans-serif;max-width:520px;margin:80px auto;text-align:center">
          <h2>✓ Signed in to Google</h2><p>You can close this tab and return to the terminal.</p></div>`);
        server.close();
        const creds = await exchangeCodeForTokens({ ...cfg, code });
        resolve(creds);
      } catch (e) {
        server.close(); reject(e);
      }
    });
    server.listen(port, () => {
      const url = buildAuthorizeUrl({
        ...cfg,
        scopes: opts.scopes,
        state,
        accessType: "offline",
        prompt: "consent",
      });
      if (opts.open) {
        try { opts.open(url); } catch { /* ignore */ }
      }
      console.log(`Open this URL in your browser to sign in:\n\n  ${url}\n`);
      console.log(`(Waiting for callback on http://localhost:${port}/callback ...)`);
    });
  });
}
