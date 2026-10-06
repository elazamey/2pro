import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { GitHub } from "@2pro/sdk";
import { FigmaClient } from "@2pro/figma";
import { extractDesignTokens, tokensToCss, tokensToTailwindTheme, generateTailwind } from "@2pro/figma";
import { parseFigmaUrl } from "@2pro/figma";
import { GoogleClient, buildAuthorizeUrl as googleAuthUrl, exchangeCodeForTokens as googleExchangeCode, scopes as googleScopes, DRIVE_READONLY, DRIVE_FILE, GMAIL_READONLY, GMAIL_SEND, GMAIL_MODIFY } from "@2pro/google";
import { GitLab } from "@2pro/gitlab";
import { AIGateway } from "@2pro/ai";
import { WebhookEngine } from "@2pro/webhooks";
import { LinearClient } from "@2pro/linear";
import { NotionClient } from "@2pro/notion";
import { parseCookies } from "./cookies.js";
import { createSessionMiddleware } from "./session.js";
import { buildAuthorizeUrl, exchangeCodeForToken, fetchAuthenticatedUser } from "./auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config (from env) ---
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SCOPES = (process.env.GITHUB_SCOPES || "repo,read:user,read:org").split(",").map(s => s.trim()).filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const FALLBACK_TOKEN = process.env.FALLBACK_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL; // optional override; otherwise inferred from request

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_PATH = "/auth/google/callback";

const app = express();
app.set("trust proxy", 1);

// --- Webhook engine (receives raw bodies for HMAC verification) ---
const webhookEngine = new WebhookEngine({
  secrets: { github: process.env.GITHUB_WEBHOOK_SECRET, gitlab: process.env.GITLAB_WEBHOOK_SECRET },
  rules: [
    { id: "log", name: "Log all events", enabled: true, when: {}, action: "log-event" },
    { id: "failures", name: "Alert on CI failures", enabled: true, when: {}, action: "alert-on-failure" },
    { id: "merges", name: "Notify on merges", enabled: true, when: {}, action: "notify-on-merge" },
    { id: "newpr", name: "Alert on new PRs", enabled: true, when: {}, action: "alert-new-pr" },
  ],
  log: (level, msg, meta) => {
    const line = `[webhooks:${level}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`;
    if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.log(line);
  },
});

// Raw body capture only for /api/webhooks/* routes
app.use("/api/webhooks", express.raw({ type: "*/*", limit: "1mb" }));
app.post("/api/webhooks/github", async (req, res) => {
  try {
    const raw = req.body?.toString?.() ?? "";
    const { event, results } = await webhookEngine.ingest("github", raw, req.headers);
    res.json({ ok: true, event: event.type, signatureValid: event.signatureValid, results });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.post("/api/webhooks/gitlab", async (req, res) => {
  try {
    const raw = req.body?.toString?.() ?? "";
    const { event, results } = await webhookEngine.ingest("gitlab", raw, req.headers);
    res.json({ ok: true, event: event.type, signatureValid: event.signatureValid, results });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.use(express.json());
app.use(parseCookies);
app.use(createSessionMiddleware({
  secret: SESSION_SECRET,
  // When deployed behind HTTPS (Vercel/Railway/etc), the cookie will be auto-marked secure
  // when req.protocol === "https" (we patch per-response below).
}));

// Mark cookies secure when the request was delivered over HTTPS.
app.use((req, res, next) => {
  const origCookie = res.cookie.bind(res);
  res.cookie = function (name, value, opts = {}) {
    if (req.protocol === "https") opts.secure = true;
    return origCookie(name, value, opts);
  };
  next();
});

// --- Auth helpers ---
function baseUrlFor(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto")?.split(",")[0] || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

function tokenFor(req) {
  // Prefer the user's OAuth-session token.
  if (req.session?.accessToken) return req.session.accessToken;
  // Fall back to a server-configured PAT (for read-only public dashboards).
  return FALLBACK_TOKEN;
}

function clientFor(req) {
  const token = tokenFor(req);
  if (!token) return null;
  return new GitHub({ token });
}

function requireAuth(req, res, next) {
  if (!tokenFor(req)) {
    return res.status(401).json({ error: "Not signed in. Visit /auth/login to sign in with GitHub." });
  }
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// --- Static UI ---
app.use(express.static(path.join(__dirname, "public")));

// --- OAuth routes ---
app.get("/auth/login", (req, res) => {
  if (!CLIENT_ID) {
    res.status(500).type("html").send(`<!doctype html><meta charset=utf-8>
      <title>OAuth not configured</title>
      <div style="font-family:sans-serif;max-width:600px;margin:60px auto;line-height:1.6">
        <h1>GitHub OAuth is not configured</h1>
        <p>Set <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> in your environment to enable sign-in.</p>
        <p>Create an OAuth App at <a href="https://github.com/settings/developers">github.com/settings/developers</a>.</p>
        <p>For now you can also use a server token: set <code>GITHUB_TOKEN</code> in the environment to use the dashboard read-only.</p>
        <p><a href="/">← Back</a></p>
      </div>`);
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  res.setSession(req.session);
  const redirectUri = `${baseUrlFor(req)}/auth/callback`;
  res.redirect(buildAuthorizeUrl({ clientId: CLIENT_ID, redirectUri, scopes: SCOPES, state }));
});

app.get("/auth/callback", asyncHandler(async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).type("html").send(`<h1>OAuth error</h1><p>${error} – ${error_description ?? ""}</p><a href="/">Back</a>`);
  if (!code || !state) return res.status(400).send("Missing code or state");
  if (state !== req.session.oauthState) return res.status(400).send("State mismatch");

  const redirectUri = `${baseUrlFor(req)}/auth/callback`;
  const { accessToken } = await exchangeCodeForToken({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: String(code), redirectUri,
  });
  const user = await fetchAuthenticatedUser(accessToken);

  res.setSession({
    accessToken,
    userId: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url,
  });
  res.redirect("/");
}));

app.post("/auth/logout", (_req, res) => {
  res.clearSession();
  res.json({ ok: true });
});

app.get("/auth/session", (req, res) => {
  if (req.session?.accessToken) {
    res.json({
      signedIn: true,
      login: req.session.login,
      name: req.session.name,
      avatarUrl: req.session.avatarUrl,
      htmlUrl: req.session.htmlUrl,
      authMethod: "oauth",
    });
  } else if (FALLBACK_TOKEN) {
    res.json({ signedIn: true, authMethod: "server-token", login: null });
  } else {
    res.json({ signedIn: false, oauthConfigured: Boolean(CLIENT_ID) });
  }
});

// --- API routes ---
app.get("/api/me", requireAuth, asyncHandler(async (req, res) => {
  const gh = clientFor(req);
  if (req.session.accessToken && req.session.login) {
    // If OAuth, we already have basic info; enrich via /user endpoint for plan counts etc.
    res.json(await gh.users.me());
  } else {
    res.json(await gh.users.me());
  }
}));

app.get(
  "/api/repos",
  requireAuth,
  asyncHandler(async (req, res) => {
    const gh = clientFor(req);
    const { user, org, sort = "updated", per_page = 30 } = req.query;
    let repos;
    if (org) repos = await gh.repos.listForOrg(String(org), { sort: String(sort), perPage: Number(per_page) });
    else if (user) repos = await gh.repos.listForUser(String(user), { sort: String(sort), perPage: Number(per_page) });
    else repos = await gh.repos.list({ sort: String(sort), perPage: Number(per_page) });
    res.json(repos);
  }),
);

app.all("/api/repos/:owner/:repo*", requireAuth);

app.get("/api/repos/:owner/:repo", asyncHandler(async (req, res) => {
  res.json(await clientFor(req).repos.get(req.params.owner, req.params.repo));
}));

app.get("/api/repos/:owner/:repo/branches", asyncHandler(async (req, res) => {
  res.json(await clientFor(req).repos.listBranches(req.params.owner, req.params.repo, { perPage: 50 }));
}));

app.get("/api/repos/:owner/:repo/commits", asyncHandler(async (req, res) => {
  const gh = clientFor(req);
  const { owner, repo } = req.params;
  res.json(await gh.repos.listCommits(owner, repo, { perPage: 20, sha: req.query.sha ? String(req.query.sha) : undefined }));
}));

app.get("/api/repos/:owner/:repo/issues", asyncHandler(async (req, res) => {
  const gh = clientFor(req);
  const { owner, repo } = req.params;
  const state = String(req.query.state ?? "open");
  res.json((await gh.issues.list(owner, repo, { state, perPage: 30 })).filter(i => !i.pull_request));
}));

app.post("/api/repos/:owner/:repo/issues", asyncHandler(async (req, res) => {
  const gh = clientFor(req);
  const { owner, repo } = req.params;
  const { title, body, labels } = req.body || {};
  if (!title) return res.status(400).json({ error: "title is required" });
  res.json(await gh.issues.create(owner, repo, { title, body, labels }));
}));

app.get("/api/repos/:owner/:repo/pulls", asyncHandler(async (req, res) => {
  const gh = clientFor(req);
  const { owner, repo } = req.params;
  res.json(await gh.pulls.list(owner, repo, { state: String(req.query.state ?? "open"), perPage: 30 }));
}));

app.get("/api/repos/:owner/:repo/actions/runs", asyncHandler(async (req, res) => {
  const gh = clientFor(req);
  const { owner, repo } = req.params;
  res.json(await gh.actions.listRuns(owner, repo, {
    branch: req.query.branch ? String(req.query.branch) : undefined,
    perPage: 25,
  }));
}));

app.post("/api/repos/:owner/:repo/actions/runs/:runId/rerun", asyncHandler(async (req, res) => {
  await clientFor(req).actions.rerun(req.params.owner, req.params.repo, Number(req.params.runId));
  res.json({ ok: true });
}));

app.post("/api/repos/:owner/:repo/actions/runs/:runId/cancel", asyncHandler(async (req, res) => {
  await clientFor(req).actions.cancel(req.params.owner, req.params.repo, Number(req.params.runId));
  res.json({ ok: true });
}));

app.get("/api/repos/:owner/:repo/actions/workflows", asyncHandler(async (req, res) => {
  res.json(await clientFor(req).actions.listWorkflows(req.params.owner, req.params.repo));
}));

// --- Google helpers ------------------------------------------------------
function googleClientFor(req) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  const creds = req.session.googleCredentials;
  if (!creds) return null;
  const redirectUri = `${baseUrlFor(req)}${GOOGLE_REDIRECT_PATH}`;
  return new GoogleClient(
    { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri },
    creds,
  );
}

function requireGoogle(req, res) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(400).json({ error: "Google not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });
    return null;
  }
  if (!req.session.googleCredentials) {
    res.status(401).json({ error: "Not connected to Google. Visit /auth/google/login." });
    return null;
  }
  return googleClientFor(req);
}

// --- Google OAuth endpoints ---
app.get("/auth/google/status", (req, res) => {
  res.json({
    configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    connected: Boolean(req.session.googleCredentials),
  });
});

app.get("/auth/google/login", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(400).send("Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.googleOAuthState = state;
  const redirectUri = `${baseUrlFor(req)}${GOOGLE_REDIRECT_PATH}`;
  res.setSession(req.session);
  res.redirect(googleAuthUrl({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri,
    state,
    scopes: googleScopes(DRIVE_READONLY, DRIVE_FILE, GMAIL_READONLY, GMAIL_SEND, GMAIL_MODIFY),
    accessType: "offline",
    prompt: "consent",
    includeGrantedScopes: true,
  }));
});

app.get(GOOGLE_REDIRECT_PATH, asyncHandler(async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(400).send("Not configured");
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Google OAuth error: ${error}`);
  if (!code || state !== req.session.googleOAuthState) return res.status(400).send("State mismatch or missing code");
  const redirectUri = `${baseUrlFor(req)}${GOOGLE_REDIRECT_PATH}`;
  const creds = await googleExchangeCode({
    clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri, code: String(code),
  });
  req.session.googleCredentials = creds;
  delete req.session.googleOAuthState;
  res.setSession(req.session);
  res.redirect("/?google=connected");
}));

app.post("/auth/google/logout", (req, res) => {
  delete req.session.googleCredentials;
  res.setSession(req.session);
  res.json({ ok: true });
});

// --- Google Drive / Gmail API ---
app.get("/api/drive/files", asyncHandler(async (req, res) => {
  const g = requireGoogle(req, res); if (!g) return;
  const folderId = String(req.query.folderId ?? "root");
  const q = req.query.query ? String(req.query.query) : undefined;
  const max = Number(req.query.max ?? 20);
  const result = await g.drive.list({ folderId, query: q, pageSize: max, trashed: false });
  res.json(result);
}));

app.get("/api/gmail/messages", asyncHandler(async (req, res) => {
  const g = requireGoogle(req, res); if (!g) return;
  const unread = req.query.unread === "true";
  const query = req.query.query ? String(req.query.query) : (unread ? "is:unread" : undefined);
  const result = await g.gmail.list({ query, maxResults: Number(req.query.max ?? 20) });
  res.json(result);
}));

app.get("/api/gmail/messages/:id", asyncHandler(async (req, res) => {
  const g = requireGoogle(req, res); if (!g) return;
  res.json(await g.gmail.get(req.params.id));
}));

app.get("/api/gmail/unread-count", asyncHandler(async (req, res) => {
  const g = requireGoogle(req, res); if (!g) return;
  res.json({ count: await g.gmail.unreadCount() });
}));

app.post("/api/gmail/messages/:id/read", asyncHandler(async (req, res) => {
  const g = requireGoogle(req, res); if (!g) return;
  await g.gmail.markRead(req.params.id);
  res.json({ ok: true });
}));

// --- GitLab endpoints ----------------------------------------------------
function gitlabFor(req) {
  const t = req.session.gitlabToken;
  if (!t) return null;
  return new GitLab({ token: t, baseUrl: req.session.gitlabUrl || undefined });
}
function requireGitLab(req, res) {
  if (!req.session.gitlabToken) {
    res.status(401).json({ error: "Add your GitLab personal access token in the GitLab tab." });
    return null;
  }
  return gitlabFor(req);
}

app.get("/api/gitlab/status", (req, res) => {
  res.json({ connected: Boolean(req.session.gitlabToken), url: req.session.gitlabUrl || "https://gitlab.com" });
});
app.post("/api/gitlab/connect", (req, res) => {
  const { token, url } = req.body || {};
  if (!token) return res.status(400).json({ error: "token required" });
  req.session.gitlabToken = String(token);
  if (url) req.session.gitlabUrl = String(url); else delete req.session.gitlabUrl;
  res.setSession(req.session);
  res.json({ ok: true });
});
app.post("/api/gitlab/disconnect", (req, res) => {
  delete req.session.gitlabToken;
  delete req.session.gitlabUrl;
  res.setSession(req.session);
  res.json({ ok: true });
});

app.get("/api/gitlab/projects", asyncHandler(async (req, res) => {
  const gl = requireGitLab(req, res); if (!gl) return;
  const search = req.query.search ? String(req.query.search) : undefined;
  res.json(await gl.projects.list({ search, perPage: 30 }));
}));
app.get("/api/gitlab/projects/:id", asyncHandler(async (req, res) => {
  const gl = requireGitLab(req, res); if (!gl) return;
  res.json(await gl.projects.get(req.params.id));
}));
app.get("/api/gitlab/projects/:id/issues", asyncHandler(async (req, res) => {
  const gl = requireGitLab(req, res); if (!gl) return;
  res.json(await gl.issues.list(req.params.id, { state: String(req.query.state ?? "opened"), perPage: 30 }));
}));
app.get("/api/gitlab/projects/:id/merge_requests", asyncHandler(async (req, res) => {
  const gl = requireGitLab(req, res); if (!gl) return;
  res.json(await gl.mergeRequests.list(req.params.id, { state: String(req.query.state ?? "opened"), perPage: 30 }));
}));
app.get("/api/gitlab/projects/:id/pipelines", asyncHandler(async (req, res) => {
  const gl = requireGitLab(req, res); if (!gl) return;
  res.json(await gl.pipelines.list(req.params.id, { perPage: 25 }));
}));

// --- Figma endpoints -----------------------------------------------------
// Figma is independent from GitHub auth: it uses FIGMA_ACCESS_TOKEN from the
// server environment. Callers must hit /api/figma/* only when configured.
app.get("/api/figma/status", (_req, res) => {
  res.json({ configured: Boolean(process.env.FIGMA_ACCESS_TOKEN) });
});

app.get("/api/figma/tokens", asyncHandler(async (req, res) => {
  if (!process.env.FIGMA_ACCESS_TOKEN) return res.status(400).json({ error: "FIGMA_ACCESS_TOKEN not set on the server" });
  const url = String(req.query.url ?? "");
  if (!url) return res.status(400).json({ error: "url is required" });
  const figma = new FigmaClient({ token: process.env.FIGMA_ACCESS_TOKEN });
  const { file, node } = await figma.resolve(url);
  const source = node ?? file.document;
  const tokens = extractDesignTokens({ ...file, document: source });
  res.json({
    fileName: file.name,
    tokens,
    css: tokensToCss(tokens),
    tailwind: tokensToTailwindTheme(tokens),
  });
}));

app.get("/api/figma/code", asyncHandler(async (req, res) => {
  if (!process.env.FIGMA_ACCESS_TOKEN) return res.status(400).json({ error: "FIGMA_ACCESS_TOKEN not set on the server" });
  const url = String(req.query.url ?? "");
  const nodeArg = req.query.node ? String(req.query.node) : undefined;
  if (!url) return res.status(400).json({ error: "url is required" });
  const figma = new FigmaClient({ token: process.env.FIGMA_ACCESS_TOKEN });
  const parsed = parseFigmaUrl(url);
  let target;
  if (nodeArg) {
    const p2 = parseFigmaUrl(nodeArg);
    const nodes = await figma.getNodes(p2.fileKey ?? parsed.fileKey, [p2.nodeId ?? nodeArg]);
    target = Object.values(nodes)[0]?.document;
  } else if (parsed.nodeId) {
    const nodes = await figma.getNodes(parsed.fileKey, [parsed.nodeId]);
    target = Object.values(nodes)[0]?.document;
  } else {
    const file = await figma.getFile(parsed.fileKey);
    target = file.document.children?.[0]?.children?.find(c => c.type === "FRAME" || c.type === "COMPONENT" || c.type === "INSTANCE");
  }
  if (!target) return res.status(404).json({ error: "No frame found. Pass ?node=<id-or-url>." });
  const { html, warnings } = generateTailwind(target);
  res.json({ fileName: target.name, html, warnings });
}));

// --- AI Gateway ---------------------------------------------------------
const ai = (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY)
  ? new AIGateway({
      openaiApiKey: process.env.OPENAI_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    })
  : null;

app.get("/api/ai/status", (_req, res) => {
  res.json({
    configured: Boolean(ai),
    models: ai ? ai.listModels() : [],
  });
});

app.post("/api/ai/chat", asyncHandler(async (req, res) => {
  if (!ai) return res.status(400).json({ error: "AI not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY." });
  const { messages, model } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: "messages[] required" });
  const r = await ai.chat({ messages, model });
  res.json(r);
}));

// High-level: summarize a Gmail message
app.post("/api/ai/summarize-email", asyncHandler(async (req, res) => {
  if (!ai) return res.status(400).json({ error: "AI not configured" });
  const { from, subject, body, model } = req.body || {};
  res.json(await ai.summarizeEmail({ from, subject, body, model }));
}));

// High-level: generate PR description from diff
app.post("/api/ai/pr-description", asyncHandler(async (req, res) => {
  if (!ai) return res.status(400).json({ error: "AI not configured" });
  const { title, diff, commits, model } = req.body || {};
  res.json({ description: await ai.generatePRDescription({ title, diff, commits, model }) });
}));

// Webhook management
app.get("/api/webhooks/status", (_req, res) => {
  res.json({
    githubSecret: !!process.env.GITHUB_WEBHOOK_SECRET,
    gitlabSecret: !!process.env.GITLAB_WEBHOOK_SECRET,
    githubUrl: "/api/webhooks/github",
    gitlabUrl: "/api/webhooks/gitlab",
    rules: webhookEngine.rules.map(r => ({ id: r.id, name: r.name, enabled: r.enabled, action: r.action, when: r.when })),
    actions: webhookEngine.listActions(),
    recent: webhookEngine.recent.slice(0, 30),
  });
});
app.post("/api/webhooks/rules/:id/toggle", (req, res) => {
  const rule = webhookEngine.rules.find(r => r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: "rule not found" });
  rule.enabled = req.body?.enabled ?? !rule.enabled;
  res.json({ ok: true, rule: { id: rule.id, enabled: rule.enabled } });
});
app.post("/api/webhooks/test", asyncHandler(async (req, res) => {
  const { source = "github", type = "ping" } = req.body || {};
  const payload = source === "github"
    ? JSON.stringify({ zen: "testing", repository: { full_name: "test/repo" }, check_run: type.includes("failure") ? { conclusion: "failure", name: "build" } : undefined })
    : JSON.stringify({ object_attributes: { status: type === "pipeline.failed" ? "failed" : "success", ref: "main" }, project: { path_with_namespace: "test/repo" } });
  const headers = source === "github"
    ? { "x-github-event": type.split(".")[0], "x-github-delivery": "test-" + Date.now() }
    : { "x-gitlab-event": type === "pipeline.failed" ? "Pipeline Hook" : "Push Hook", "x-gitlab-event-uuid": "test-" + Date.now() };
  const { event, results } = await webhookEngine.ingest(source, payload, headers);
  res.json({ ok: true, event: { type: event.type, signatureValid: event.signatureValid }, results });
}));

// Linear
function linearFor(req) {
  const tok = req.session.linearApiKey || process.env.LINEAR_API_KEY;
  if (!tok) throw Object.assign(new Error("Linear not connected. Set LINEAR_API_KEY or connect via the dashboard."), { status: 401 });
  return new LinearClient({ apiKey: tok });
}
app.post("/api/linear/connect", (req, res) => {
  req.session.linearApiKey = req.body?.apiKey;
  res.json({ ok: true });
});
app.post("/api/linear/disconnect", (req, res) => { delete req.session.linearApiKey; res.json({ ok: true }); });
app.get("/api/linear/status", (req, res) => res.json({ connected: !!(req.session.linearApiKey || process.env.LINEAR_API_KEY) }));
app.get("/api/linear/me", asyncHandler(async (req, res) => res.json(await linearFor(req).viewer())));
app.get("/api/linear/teams", asyncHandler(async (req, res) => res.json(await linearFor(req).listTeams())));
app.get("/api/linear/issues", asyncHandler(async (req, res) => {
  res.json(await linearFor(req).listIssues(Number(req.query.first || 25), { teamId: req.query.team }));
}));
app.get("/api/linear/projects", asyncHandler(async (req, res) => res.json(await linearFor(req).listProjects(Number(req.query.first || 25)))));
app.post("/api/linear/issues", asyncHandler(async (req, res) => {
  const { title, description, teamId, projectId, priority } = req.body || {};
  if (!title || !teamId) return res.status(400).json({ error: "title and teamId required" });
  res.json(await linearFor(req).createIssue({ title, description, teamId, projectId, priority }));
}));

// Notion
function notionFor(req) {
  const tok = req.session.notionToken || process.env.NOTION_TOKEN;
  if (!tok) throw Object.assign(new Error("Notion not connected. Set NOTION_TOKEN or connect via the dashboard."), { status: 401 });
  return new NotionClient({ token: tok });
}
app.post("/api/notion/connect", (req, res) => { req.session.notionToken = req.body?.token; res.json({ ok: true }); });
app.post("/api/notion/disconnect", (req, res) => { delete req.session.notionToken; res.json({ ok: true }); });
app.get("/api/notion/status", (req, res) => res.json({ connected: !!(req.session.notionToken || process.env.NOTION_TOKEN) }));
app.get("/api/notion/search", asyncHandler(async (req, res) => {
  res.json(await notionFor(req).searchDatabases((req.query.q) || undefined));
}));
app.get("/api/notion/databases/:id", asyncHandler(async (req, res) => {
  res.json(await notionFor(req).queryDatabase(req.params.id));
}));
app.get("/api/notion/pages/:id/blocks", asyncHandler(async (req, res) => {
  res.json(await notionFor(req).listBlocks(req.params.id));
}));
app.post("/api/notion/pages/:id/append", asyncHandler(async (req, res) => {
  await notionFor(req).appendText(req.params.id, req.body?.text || "");
  res.json({ ok: true });
}));

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? String(err) });
});

app.listen(PORT, HOST, () => {
  console.log(`2pro dashboard listening on http://${HOST}:${PORT}`);
  console.log(`  OAuth: ${CLIENT_ID ? "configured" : "NOT configured (use GITHUB_TOKEN fallback or set GITHUB_CLIENT_ID/SECRET)"}`);
  console.log(`  Fallback token: ${FALLBACK_TOKEN ? "present" : "absent"}`);
});
