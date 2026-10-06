const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  me: null,
  repos: [],
  currentRepo: null, // "owner/repo"
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error || JSON.stringify(j); } catch { /* */ }
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function timeAgo(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function setActiveTab(name) {
  $$(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach(t => t.classList.toggle("active", t.id === `tab-${name}`));
}

async function loadMe() {
  try {
    const session = await api("/auth/session");
    if (!session.signedIn) {
      $("#userbox").innerHTML = session.oauthConfigured
        ? `<a class="btn-github" href="/auth/login">Sign in with GitHub</a>`
        : `<span class="muted" title="Set GITHUB_TOKEN or GITHUB_CLIENT_ID/SECRET">Not signed in</span>`;
      document.getElementById("reposGrid").innerHTML = `
        <div style="grid-column:1/-1;padding:40px;text-align:center">
          <h2>Sign in to get started</h2>
          <p class="muted">Connect your GitHub account to browse repos, manage issues and PRs, and monitor Actions.</p>
          ${session.oauthConfigured ? `<p><a class="btn-github" href="/auth/login" style="display:inline-block">Sign in with GitHub</a></p>` :
          `<p class="muted" style="font-size:13px">OAuth is not configured. Configure GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET or set a fallback GITHUB_TOKEN on the server.</p>`}
        </div>`;
      return;
    }
    let me;
    try { me = await api("/api/me"); } catch { me = null; }
    state.me = me || { login: session.login, avatar_url: session.avatarUrl, name: session.name };
    const authBadge = session.authMethod === "server-token"
      ? `<span class="muted" style="font-size:11px">(server token)</span>`
      : "";
    const logoutBtn = session.authMethod === "oauth"
      ? `<button id="logoutBtn" class="ghost" style="padding:4px 8px;font-size:12px">Sign out</button>`
      : "";
      $("#userbox").innerHTML = `
      <img src="${state.me.avatar_url}" alt="" />
      <span>
        <strong>${escapeHtml(state.me.login || "")}</strong> ${authBadge}
        <br /><span class="muted">${escapeHtml(state.me.name ?? "")}</span>
      </span>
      ${logoutBtn}
    `;
    $("#loadBtn").disabled = false;
    document.getElementById("repoInput").disabled = false;
    document.getElementById("stateSelect").disabled = false;
    document.getElementById("branchInput").disabled = false;
    const logoutBtn2 = document.getElementById("logoutBtn");
    if (logoutBtn2) logoutBtn2.addEventListener("click", async () => {
      await fetch("/auth/logout", { method: "POST" });
      location.reload();
    });
    loadReposList();
  } catch (e) {
    $("#userbox").innerHTML = `<span class="muted">Error: ${escapeHtml(e.message)}</span>`;
  }
}

async function loadReposList() {
  const grid = $("#reposGrid");
  grid.innerHTML = `<div class="spinner"></div> Loading repositories…`;
  try {
    const repos = await api("/api/repos?per_page=30");
    state.repos = repos;
    grid.innerHTML = repos.map(r => `
      <div class="repo-card" data-repo="${r.full_name}">
        <div class="name">
          <span class="badge ${r.private ? "private" : "public"}">${r.private ? "private" : "public"}</span>
          ${escapeHtml(r.full_name)}
        </div>
        <div class="desc">${escapeHtml(r.description ?? "")}</div>
        <div class="meta">
          <span>★ ${r.stargazers_count}</span>
          <span>⑂ ${r.forks_count}</span>
          <span>● ${escapeHtml(r.language ?? "")}</span>
          <span>${timeAgo(r.updated_at)}</span>
        </div>
      </div>
    `).join("");
    grid.querySelectorAll(".repo-card").forEach(card => {
      card.addEventListener("click", () => {
        const name = card.dataset.repo;
        $("#repoInput").value = name;
        loadRepo(name);
      });
    });
  } catch (e) {
    grid.innerHTML = `<p class="muted">Error: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadRepo(slug) {
  if (!slug || !slug.includes("/")) {
    state.currentRepo = null;
    $("#newIssueBtn").disabled = true;
    return;
  }
  state.currentRepo = slug;
  $("#newIssueBtn").disabled = false;
  const [owner, repo] = slug.split("/");
  try {
    const [details, branches] = await Promise.all([
      api(`/api/repos/${owner}/${repo}`),
      api(`/api/repos/${owner}/${repo}/branches`),
    ]);
    const stats = `
      <div class="kv" style="margin-bottom:20px">
        <div><div class="n">${details.stargazers_count}</div><div class="l">Stars</div></div>
        <div><div class="n">${details.forks_count}</div><div class="l">Forks</div></div>
        <div><div class="n">${details.open_issues_count}</div><div class="l">Open issues</div></div>
        <div><div class="n">${details.subscribers_count ?? "-"}</div><div class="l">Watchers</div></div>
        <div><div class="n">${escapeHtml(details.language ?? "-")}</div><div class="l">Language</div></div>
        <div><div class="n">${branches.length}</div><div class="l">Branches</div></div>
      </div>
      <p class="muted">${escapeHtml(details.description ?? "No description")} · <a href="${details.html_url}" target="_blank">View on GitHub ↗</a></p>
    `;
    // Prepend stats to overview without overwriting repo grid
    const existing = document.getElementById("repoStats");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = "repoStats";
    el.innerHTML = `<h2 style="margin:0 0 8px">${escapeHtml(slug)}</h2>${stats}`;
    $("#tab-overview").prepend(el);
    // Load all tabs
    await Promise.all([loadIssues(), loadPulls(), loadRuns(), loadCommits()]);
    setActiveTab("issues");
  } catch (e) {
    console.error(e);
    alert(`Failed to load ${slug}: ${e.message}`);
  }
}

async function loadIssues() {
  const slug = state.currentRepo; if (!slug) return;
  const [owner, repo] = slug.split("/");
  const stateVal = $("#stateSelect").value;
  const el = $("#issuesList");
  el.innerHTML = `<div class="spinner"></div>`;
  try {
    const issues = await api(`/api/repos/${owner}/${repo}/issues?state=${stateVal}`);
    if (!issues.length) { el.innerHTML = `<p class="muted">No ${stateVal} issues.</p>`; return; }
    el.innerHTML = `<div class="card-list">${issues.map(i => `
      <div class="item">
        <div class="left">
          <div class="title">
            <span class="badge ${i.state === "open" ? "open" : "closed"}">${i.state}</span>
            <a href="${i.html_url}" target="_blank">${escapeHtml(i.title)}</a>
            <span class="muted">#${i.number}</span>
          </div>
          <div class="sub">by ${i.user?.login ?? "?"} · ${timeAgo(i.updated_at)} · ${i.comments} comments${i.labels.length ? " · " + i.labels.map(l => `<span style="color:#${l.color}">● ${escapeHtml(l.name)}</span>`).join(" ") : ""}</div>
        </div>
      </div>
    `).join("")}</div>`;
  } catch (e) {
    el.innerHTML = `<p class="muted">Error: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadPulls() {
  const slug = state.currentRepo; if (!slug) return;
  const [owner, repo] = slug.split("/");
  const stateVal = $("#stateSelect").value;
  const el = $("#pullsList");
  el.innerHTML = `<div class="spinner"></div>`;
  try {
    const prs = await api(`/api/repos/${owner}/${repo}/pulls?state=${stateVal}`);
    if (!prs.length) { el.innerHTML = `<p class="muted">No ${stateVal} pull requests.</p>`; return; }
    el.innerHTML = `<div class="card-list">${prs.map(p => {
      const badge = p.merged ? `<span class="badge merged">merged</span>`
        : p.draft ? `<span class="badge draft">draft</span>`
        : `<span class="badge ${p.state === "open" ? "open" : "closed"}">${p.state}</span>`;
      return `
        <div class="item">
          <div class="left">
            <div class="title">
              ${badge}
              <a href="${p.html_url}" target="_blank">${escapeHtml(p.title)}</a>
              <span class="muted">#${p.number}</span>
            </div>
            <div class="sub">${escapeHtml(p.head.ref)} → ${escapeHtml(p.base.ref)} · by ${p.user?.login ?? "?"} · +${p.additions} -${p.deletions} · ${timeAgo(p.updated_at)}</div>
          </div>
        </div>`;
    }).join("")}</div>`;
  } catch (e) {
    el.innerHTML = `<p class="muted">Error: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadRuns() {
  const slug = state.currentRepo; if (!slug) return;
  const [owner, repo] = slug.split("/");
  const branch = $("#branchInput").value.trim();
  const el = $("#runsList");
  el.innerHTML = `<div class="spinner"></div>`;
  try {
    const runs = await api(`/api/repos/${owner}/${repo}/actions/runs${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`);
    if (!runs.length) { el.innerHTML = `<p class="muted">No workflow runs.</p>`; return; }
    el.innerHTML = `<div class="card-list">${runs.map(r => {
      const badgeClass = r.conclusion === "success" ? "success"
        : r.conclusion === "failure" ? "failure"
        : r.status === "completed" ? (r.conclusion || "success") : r.status;
      return `
        <div class="item">
          <div class="left">
            <div class="title">
              <span class="badge ${badgeClass}">${r.conclusion || r.status}</span>
              <a href="${r.html_url}" target="_blank">${escapeHtml(r.name || `#${r.run_number}`)}</a>
              <span class="muted">#${r.run_number}</span>
            </div>
            <div class="sub">${escapeHtml(r.head_branch)} · ${escapeHtml(r.event)} · ${escapeHtml(r.head_commit?.message.split("\n")[0] ?? "")} · ${r.run_started_at ? timeAgo(r.run_started_at) : "pending"}</div>
          </div>
          <div class="actions">
            ${r.status !== "completed" ? `<button data-act="cancel" data-id="${r.id}">Cancel</button>` : ""}
            <button data-act="rerun" data-id="${r.id}">Re-run</button>
          </div>
        </div>`;
    }).join("")}</div>`;
    el.querySelectorAll("button[data-act]").forEach(b => {
      b.addEventListener("click", async () => {
        const id = b.dataset.id, act = b.dataset.act;
        b.disabled = true;
        try {
          if (act === "cancel") await api(`/api/repos/${owner}/${repo}/actions/runs/${id}/cancel`, { method: "POST" });
          else await api(`/api/repos/${owner}/${repo}/actions/runs/${id}/rerun`, { method: "POST" });
          await loadRuns();
        } catch (e) { alert(e.message); b.disabled = false; }
      });
    });
  } catch (e) {
    el.innerHTML = `<p class="muted">Error: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadCommits() {
  const slug = state.currentRepo; if (!slug) return;
  const [owner, repo] = slug.split("/");
  const el = $("#commitsList");
  el.innerHTML = `<div class="spinner"></div>`;
  try {
    const commits = await api(`/api/repos/${owner}/${repo}/commits?per_page=20`);
    if (!commits.length) { el.innerHTML = `<p class="muted">No commits.</p>`; return; }
    el.innerHTML = `<div class="card-list">${commits.map(c => `
      <div class="item">
        <div class="left">
          <div class="title">
            <code class="muted">${c.sha.slice(0,7)}</code>
            <a href="${c.html_url}" target="_blank">${escapeHtml(c.commit.message.split("\n")[0])}</a>
          </div>
          <div class="sub">by ${c.author?.login ?? c.commit.author?.name ?? "?"} · ${timeAgo(c.commit.author?.date ?? "")}</div>
        </div>
      </div>
    `).join("")}</div>`;
  } catch (e) {
    el.innerHTML = `<p class="muted">Error: ${escapeHtml(e.message)}</p>`;
  }
}

// Wire up UI
$$(".tabs button").forEach(btn => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));
$("#loadBtn").addEventListener("click", () => {
  const slug = $("#repoInput").value.trim();
  if (slug) loadRepo(slug); else { state.currentRepo = null; $("#newIssueBtn").disabled = true; }
});
$("#repoInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#loadBtn").click(); });
$("#stateSelect").addEventListener("change", () => { if (state.currentRepo) { loadIssues(); loadPulls(); } });
$("#branchInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && state.currentRepo) loadRuns(); });

$("#newIssueBtn").addEventListener("click", () => {
  $("#issueTitle").value = ""; $("#issueBody").value = ""; $("#issueLabels").value = "";
  $("#issueModal").showModal();
});
$("#issueCancel").addEventListener("click", () => $("#issueModal").close());
$("#issueForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.currentRepo) return;
  const [owner, repo] = state.currentRepo.split("/");
  const title = $("#issueTitle").value.trim();
  const body = $("#issueBody").value.trim();
  const labels = $("#issueLabels").value.split(",").map(s => s.trim()).filter(Boolean);
  try {
    await api(`/api/repos/${owner}/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({ title, body, labels }),
    });
    $("#issueModal").close();
    await loadIssues();
  } catch (err) { alert(err.message); }
});

// Figma tab
let figmaConfigured = false;
(async function initFigma() {
  try {
    const s = await api("/api/figma/status");
    figmaConfigured = s.configured;
    document.getElementById("figmaStatus").textContent = figmaConfigured
      ? "Paste a Figma file URL (e.g. https://www.figma.com/design/abc123/Name) and extract tokens or generate code."
      : "Figma integration is not enabled. Set FIGMA_ACCESS_TOKEN on the server to enable.";
    document.getElementById("figmaTokensBtn").disabled = !figmaConfigured;
    document.getElementById("figmaCodeBtn").disabled = !figmaConfigured;
  } catch (e) { /* ignore */ }
})();

document.getElementById("figmaTokensBtn").addEventListener("click", async () => {
  const url = document.getElementById("figmaUrl").value.trim();
  if (!url) return;
  const out = document.getElementById("figmaOutput");
  out.innerHTML = `<div class="spinner"></div> Fetching tokens…`;
  try {
    const data = await api(`/api/figma/tokens?url=${encodeURIComponent(url)}`);
    const t = data.tokens;
    out.innerHTML = `
      <h3 style="margin:8px 0">${escapeHtml(data.fileName)}</h3>
      <div class="tabs-btn-row">
        <button data-view="swatches" class="primary">Swatches</button>
        <button data-view="css">CSS</button>
        <button data-view="tw">Tailwind</button>
        <button data-view="json">JSON</button>
      </div>
      <div id="figmaView"></div>
    `;
    const views = {
      swatches: () => {
        const colors = t.colors.map(c => `<span class="figma-swatch"><span class="dot" style="background:${c.hex}"></span>${escapeHtml(c.hex)} <span class="muted">${escapeHtml(c.name)}</span></span>`).join("");
        const type = t.typography.map(x => `<span class="figma-swatch">${x.fontSize}px/${Math.round(x.lineHeight ?? x.fontSize*1.4)}px · ${x.fontWeight} · ${escapeHtml(x.fontFamily)} <span class="muted">${escapeHtml(x.name)}</span></span>`).join("");
        return `<h4 style="margin:12px 0 4px">Colors</h4><div class="figma-swatches">${colors || '<span class="muted">none</span>'}</div>
                <h4 style="margin:12px 0 4px">Typography</h4><div class="figma-swatches">${type || '<span class="muted">none</span>'}</div>
                <h4 style="margin:12px 0 4px">Spacing</h4><p class="muted">${t.spacing.map(s => s.value + "px").join(", ") || "none"}</p>
                <h4 style="margin:12px 0 4px">Radii</h4><p class="muted">${t.radii.map(r => r.value + "px").join(", ") || "none"}</p>`;
      },
      css: () => `<pre class="code-block">${escapeHtml(data.css)}</pre>`,
      tw: () => `<pre class="code-block">${escapeHtml(data.tailwind)}</pre>`,
      json: () => `<pre class="code-block">${escapeHtml(JSON.stringify(t, null, 2))}</pre>`,
    };
    const render = (v) => { document.getElementById("figmaView").innerHTML = views[v](); };
    render("swatches");
    out.querySelectorAll("button[data-view]").forEach(b => b.addEventListener("click", () => {
      out.querySelectorAll("button[data-view]").forEach(x => x.classList.remove("primary"));
      b.classList.add("primary");
      render(b.dataset.view);
    }));
  } catch (e) {
    out.innerHTML = `<p class="muted">Error: ${escapeHtml(e.message)}</p>`;
  }
});

document.getElementById("figmaCodeBtn").addEventListener("click", async () => {
  const url = document.getElementById("figmaUrl").value.trim();
  if (!url) return;
  const out = document.getElementById("figmaOutput");
  out.innerHTML = `<div class="spinner"></div> Generating HTML/Tailwind…`;
  try {
    const data = await api(`/api/figma/code?url=${encodeURIComponent(url)}`);
    out.innerHTML = `
      <h3 style="margin:8px 0">${escapeHtml(data.fileName)}</h3>
      <div class="tabs-btn-row">
        <button data-view="preview" class="primary">Preview</button>
        <button data-view="code">HTML</button>
      </div>
      <div id="figmaCodeView"></div>
    `;
    const doc = `<!doctype html><html><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"><\/script><style>body{padding:24px;background:#f9fafb}</style></head><body>${data.html}</body></html>`;
    const renderPreview = () => `<iframe id="figmaFrame" style="width:100%;height:600px;border:1px solid var(--border);border-radius:8px;background:white" sandbox="allow-same-origin"></iframe>`;
    const renderCode = () => `<pre class="code-block">${escapeHtml(data.html)}</pre>`;
    const view = document.getElementById("figmaCodeView");
    const show = (which) => {
      view.innerHTML = which === "preview" ? renderPreview() : renderCode();
      if (which === "preview") {
        const f = document.getElementById("figmaFrame");
        f.srcdoc = doc;
      }
    };
    show("preview");
    out.querySelectorAll("button[data-view]").forEach(b => b.addEventListener("click", () => {
      out.querySelectorAll("button[data-view]").forEach(x => x.classList.remove("primary"));
      b.classList.add("primary");
      show(b.dataset.view);
    }));
    if (data.warnings?.length) {
      out.insertAdjacentHTML("beforeend", `<p class="muted" style="font-size:12px">${data.warnings.map(w => "⚠ " + escapeHtml(w)).join("<br/>")}</p>`);
    }
  } catch (e) {
    out.innerHTML = `<p class="muted">Error: ${escapeHtml(e.message)}</p>`;
  }
});

// Google Workspace tab
async function loadGoogle() {
  const header = document.getElementById("googleHeader");
  const grid = document.getElementById("workspaceGrid");
  try {
    const s = await api("/auth/google/status");
    if (!s.configured) {
      header.innerHTML = `<span class="muted">Google Workspace is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server, then restart.</span>`;
      grid.style.display = "none";
      return;
    }
    if (!s.connected) {
      header.innerHTML = `<a class="signin" href="/auth/google/login">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41 35 44 30 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>
        Connect Google Account
      </a>`;
      grid.style.display = "none";
      return;
    }
    header.innerHTML = `<span class="badge success">Connected</span> <span class="muted">Gmail · Drive</span> <button id="googleLogout" class="ghost" style="margin-left:auto;padding:4px 10px;font-size:12px">Disconnect</button>`;
    document.getElementById("googleLogout").addEventListener("click", async () => {
      await fetch("/auth/google/logout", { method: "POST" });
      loadGoogle();
    });
    grid.style.display = "";
    loadGmail();
    loadDrive();
  } catch (e) {
    header.innerHTML = `<span class="muted">Error: ${escapeHtml(e.message)}</span>`;
  }
}

async function loadGmail() {
  const list = document.getElementById("gmailList");
  const badge = document.getElementById("unreadBadge");
  list.innerHTML = `<div class="spinner"></div>`;
  try {
    const r = await api("/api/gmail/messages?max=15");
    try {
      const { count } = await api("/api/gmail/unread-count");
      if (count > 0) { badge.style.display = ""; badge.textContent = `${count} unread`; }
    } catch {}
    if (!r.messages.length) { list.innerHTML = `<p class="muted">No messages.</p>`; return; }
    list.innerHTML = `<div class="ws-list">${r.messages.map(m => `
      <div class="ws-item ${m.unread ? "unread" : ""}" data-id="${m.id}">
        <div style="min-width:0;flex:1">
          <div class="title">${escapeHtml(m.subject ?? "(no subject)")}</div>
          <div class="meta">${escapeHtml(m.from?.name ?? m.from?.email ?? "")} · ${m.internalDate ? timeAgo(new Date(m.internalDate).toISOString()) : ""}</div>
        </div>
      </div>`).join("")}</div>`;
    list.querySelectorAll(".ws-item").forEach(el => el.addEventListener("click", async () => {
      const id = el.dataset.id;
      const full = await api(`/api/gmail/messages/${id}`);
      alert(`From: ${full.from?.name ?? ""} <${full.from?.email ?? ""}>\nSubject: ${full.subject ?? ""}\n\n${full.textPlain ?? "(no plain text body)"}`);
      await fetch(`/api/gmail/messages/${id}/read`, { method: "POST" });
      loadGmail();
    }));
  } catch (e) {
    list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

async function loadDrive(query) {
  const list = document.getElementById("driveList");
  list.innerHTML = `<div class="spinner"></div>`;
  try {
    const qs = query ? `&query=${encodeURIComponent("name contains '" + query.replace(/'/g, "\\'") + "'")}` : "";
    const r = await api(`/api/drive/files?max=20${qs}`);
    if (!r.files.length) { list.innerHTML = `<p class="muted">No files.</p>`; return; }
    list.innerHTML = `<div class="ws-list">${r.files.map(f => `
      <div class="ws-item" data-url="${f.webViewLink || ""}">
        <div style="min-width:0;flex:1">
          <div class="title">${f.mimeType === "application/vnd.google-apps.folder" ? "📁 " : "📄 "}${escapeHtml(f.name)}</div>
          <div class="meta">${f.mimeType.split(".").pop()} · ${f.modifiedTime ? timeAgo(f.modifiedTime) : ""}</div>
        </div>
      </div>`).join("")}</div>`;
    list.querySelectorAll(".ws-item").forEach(el => el.addEventListener("click", () => {
      if (el.dataset.url) window.open(el.dataset.url, "_blank");
    }));
  } catch (e) {
    list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

document.getElementById("driveSearchBtn").addEventListener("click", () => {
  loadDrive(document.getElementById("driveQuery").value.trim());
});
document.getElementById("driveQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") loadDrive(e.target.value.trim()); });

// Activate Google tab when clicked
document.querySelector('button[data-tab="google"]').addEventListener("click", loadGoogle);

// GitLab tab
async function loadGitLab() {
  const header = document.getElementById("gitlabHeader");
  const body = document.getElementById("gitlabBody");
  header.innerHTML = `<div class="spinner"></div>`;
  try {
    const s = await api("/api/gitlab/status");
    if (!s.connected) {
      header.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="glToken" type="password" placeholder="GitLab Personal Access Token (glpat-…)" style="flex:1;min-width:280px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px" />
          <input id="glUrl" type="text" placeholder="https://gitlab.com/api/v4 (or self-hosted)" value="${s.url}" style="flex:1;min-width:280px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px" />
          <button id="glConnectBtn" class="primary">Connect</button>
        </div>
        <p class="muted" style="font-size:12px">Create a token at GitLab → User Settings → Access Tokens (scope: <code>api</code> read_api). Token is stored encrypted in your session cookie.</p>`;
      body.style.display = "none";
      document.getElementById("glConnectBtn").addEventListener("click", async () => {
        const token = document.getElementById("glToken").value.trim();
        const url = document.getElementById("glUrl").value.trim();
        if (!token) return;
        await fetch("/api/gitlab/connect", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, url: url && url !== "https://gitlab.com" ? url : undefined }),
        });
        loadGitLab();
      });
      return;
    }
    header.innerHTML = `<span class="badge success">Connected</span> <span class="muted" id="glUrlLabel"></span>
      <button id="glDisconnect" class="ghost" style="margin-left:auto;padding:4px 10px;font-size:12px">Disconnect</button>`;
    document.getElementById("glUrlLabel").textContent = s.url;
    document.getElementById("glDisconnect").addEventListener("click", async () => {
      await fetch("/api/gitlab/disconnect", { method: "POST" }); loadGitLab();
    });
    body.style.display = "";
    loadGLProjects();
  } catch (e) {
    header.innerHTML = `<span class="muted">Error: ${escapeHtml(e.message)}</span>`;
  }
}
function setGLTab(name) {
  document.querySelectorAll(".gltab").forEach(t => t.classList.toggle("active", t.id === "gl" + name[0].toUpperCase() + name.slice(1)));
  document.querySelectorAll("button[data-gltab]").forEach(b => b.classList.toggle("active", b.dataset.gltab === name));
}
document.querySelectorAll("button[data-gltab]").forEach(b => b.addEventListener("click", () => setGLTab(b.dataset.gltab)));
async function loadGLProjects() {
  const list = document.getElementById("glProjectsList");
  list.innerHTML = `<div class="spinner"></div>`;
  try {
    const projs = await api("/api/gitlab/projects");
    if (!projs.length) { list.innerHTML = `<p class="muted">No projects.</p>`; return; }
    list.innerHTML = `<div class="card-list">${projs.map(p => `
      <div class="item" data-pid="${encodeURIComponent(p.path_with_namespace)}">
        <div class="left">
          <div class="title">${p.visibility === "private" ? '<span class="badge private">private</span>' : '<span class="badge public">public</span>'} <a href="${p.web_url}" target="_blank">${escapeHtml(p.path_with_namespace)}</a></div>
          <div class="sub">${escapeHtml(p.description ?? "")} · ★ ${p.star_count} · issues ${p.open_issues_count} · ${timeAgo(p.last_activity_at)}</div>
        </div>
      </div>`).join("")}</div>`;
    list.querySelectorAll(".item").forEach(el => el.addEventListener("click", () => {
      document.getElementById("glProjectInput").value = decodeURIComponent(el.dataset.pid);
      loadGLProject(decodeURIComponent(el.dataset.pid));
      setGLTab("issues");
    }));
  } catch (e) { list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
}
async function loadGLProject(pid) {
  if (!pid) return;
  const state = document.getElementById("glStateSelect").value;
  try {
    const [issues, mrs, pipes] = await Promise.all([
      api(`/api/gitlab/projects/${encodeURIComponent(pid)}/issues?state=opened`),
      api(`/api/gitlab/projects/${encodeURIComponent(pid)}/merge_requests?state=opened`),
      api(`/api/gitlab/projects/${encodeURIComponent(pid)}/pipelines`),
    ]);
    const issueList = document.getElementById("glIssuesList");
    issueList.innerHTML = `<div class="card-list">${issues.map(i => `
      <div class="item">
        <div class="left">
          <div class="title"><span class="badge open">opened</span> <a href="${i.web_url}" target="_blank">${escapeHtml(i.title)}</a> <span class="muted">#${i.iid}</span></div>
          <div class="sub">by ${escapeHtml(i.author.username)} · ${i.user_notes_count} comments · ${timeAgo(i.updated_at)}</div>
        </div>
      </div>`).join("")}</div>`;
    const mrList = document.getElementById("glMrsList");
    mrList.innerHTML = `<div class="card-list">${mrs.map(m => `
      <div class="item">
        <div class="left">
          <div class="title"><span class="badge ${m.state === "merged" ? "merged" : m.draft ? "draft" : "open"}">${m.draft ? "draft" : m.state}</span> <a href="${m.web_url}" target="_blank">${escapeHtml(m.title)}</a> <span class="muted">!${m.iid}</span></div>
          <div class="sub">${escapeHtml(m.source_branch)} → ${escapeHtml(m.target_branch)} · ${escapeHtml(m.author.username)} · ${m.additions ?? 0}++ / ${m.deletions ?? 0}-- · ${timeAgo(m.updated_at)}</div>
        </div>
      </div>`).join("")}</div>`;
    const pipeList = document.getElementById("glPipelinesList");
    pipeList.innerHTML = `<div class="card-list">${pipes.map(p => {
      const cls = p.status === "success" ? "success" : /failed|canceled/.test(p.status) ? "failure" : p.status === "running" ? "in_progress" : "queued";
      return `<div class="item">
        <div class="left">
          <div class="title"><span class="badge ${cls}">${p.status}</span> <a href="${p.web_url}" target="_blank">#${p.iid}</a> <span class="muted">${escapeHtml(p.ref)}</span></div>
          <div class="sub">${p.sha.slice(0,8)} · ${p.source} · ${timeAgo(p.updated_at)}</div>
        </div>
      </div>`;
    }).join("")}</div>`;
  } catch (e) {
    document.getElementById("glIssuesList").innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}
document.getElementById("glLoadBtn").addEventListener("click", () => {
  const pid = document.getElementById("glProjectInput").value.trim();
  if (pid) loadGLProject(pid);
});
document.getElementById("glProjectInput").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("glLoadBtn").click(); });
document.querySelector('button[data-tab="gitlab"]').addEventListener("click", loadGitLab);

// AI Assistant tab
const aiState = { messages: [], models: [] };
async function loadAI() {
  const status = document.getElementById("aiStatus");
  const chat = document.getElementById("aiChat");
  status.innerHTML = `<div class="spinner"></div>`;
  try {
    const s = await api("/api/ai/status");
    if (!s.configured) {
      status.innerHTML = `<span class="muted">AI not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY on the server to enable the assistant.</span>`;
      chat.style.display = "none";
      return;
    }
    aiState.models = s.models;
    const sel = document.getElementById("aiModel");
    sel.innerHTML = s.models.map(m => `<option value="${m.providerId}/${m.id}">${m.providerId}/${m.id}</option>`).join("");
    status.innerHTML = `<span class="badge success">Ready</span> <span class="muted">${s.models.length} model(s) available across providers</span>`;
    chat.style.display = "";
  } catch (e) { status.innerHTML = `<span class="muted">Error: ${escapeHtml(e.message)}</span>`; }
}
function renderAIMessages() {
  const box = document.getElementById("aiMessages");
  box.innerHTML = aiState.messages.map(m => `<div class="ai-msg ${m.role}">${escapeHtml(m.content)}</div>`).join("");
  box.scrollTop = box.scrollHeight;
}
async function sendAIMessage() {
  const input = document.getElementById("aiInput");
  const text = input.value.trim(); if (!text) return;
  const model = document.getElementById("aiModel").value;
  aiState.messages.push({ role: "user", content: text });
  input.value = "";
  aiState.messages.push({ role: "assistant", content: "…" });
  renderAIMessages();
  try {
    const r = await api("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ model, messages: aiState.messages.slice(0, -1) }),
    });
    aiState.messages[aiState.messages.length - 1] = { role: "assistant", content: r.content };
    renderAIMessages();
  } catch (e) {
    aiState.messages[aiState.messages.length - 1] = { role: "assistant", content: `Error: ${e.message}` };
    renderAIMessages();
  }
}
document.getElementById("aiSend").addEventListener("click", sendAIMessage);
document.getElementById("aiInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAIMessage(); }
});
document.querySelector('button[data-tab="ai"]').addEventListener("click", loadAI);

async function loadWebhooks() {
  const s = await api("/api/webhooks/status");
  document.getElementById("webhookEndpoints").innerHTML = `
    <div><b>GitHub:</b> <code>${s.githubUrl}</code> ${s.githubSecret ? '<span class="badge success">secret set</span>' : '<span class="badge warn">no secret</span>'}</div>
    <div><b>GitLab:</b> <code>${s.gitlabUrl}</code> ${s.gitlabSecret ? '<span class="badge success">secret set</span>' : '<span class="badge warn">no secret</span>'}</div>
    <p class="muted">Set GITHUB_WEBHOOK_SECRET / GITLAB_WEBHOOK_SECRET env vars to enable HMAC verification. Configure the webhook URL in your repo's integrations settings, content-type <code>application/json</code>.</p>
  `;
  document.getElementById("webhookRules").innerHTML = `<ul class="file-list">${s.rules.map(r => `
    <li><label><input type="checkbox" data-rule="${r.id}" ${r.enabled ? "checked" : ""}/>
    <b>${escapeHtml(r.name)}</b> — <span class="muted">${escapeHtml(r.action)}</span></label></li>`).join("")}</ul>`;
  for (const cb of document.querySelectorAll('input[data-rule]')) {
    cb.addEventListener("change", async () => {
      await api(`/api/webhooks/rules/${cb.dataset.rule}/toggle`, { method: "POST", body: JSON.stringify({ enabled: cb.checked }) });
      loadWebhooks();
    });
  }
  document.getElementById("webhookEventsBody").innerHTML = s.recent.length === 0
    ? `<tr><td colspan="5" class="muted">No events yet — click "Fire test event" to simulate.</td></tr>`
    : s.recent.map(e => `<tr>
      <td>${new Date(e.deliveredAt).toLocaleTimeString()}</td>
      <td>${e.source}</td>
      <td>${escapeHtml(e.type)}</td>
      <td>${e.signatureValid ? '<span class="badge success">ok</span>' : '<span class="badge warn">unsigned</span>'}</td>
      <td class="muted">${escapeHtml((e.results||[]).map(r=>r.action).join(", ") || "—")}</td>
    </tr>`).join("");
}
document.getElementById("webhookTest").addEventListener("click", async () => {
  await api("/api/webhooks/test", { method: "POST", body: JSON.stringify({ source: "github", type: "check_run.failure" }) });
  loadWebhooks();
});
document.querySelector('button[data-tab="webhooks"]').addEventListener("click", loadWebhooks);

// Linear & Notion
async function loadIntegrations() {
  // Linear
  const ls = await api("/api/linear/status");
  document.getElementById("linearStatus").innerHTML = ls.connected ? '<span class="badge success">Connected</span>' : '<span class="muted">Not connected</span>';
  document.getElementById("linearUI").style.display = ls.connected ? "" : "none";
  document.getElementById("linearConnect").style.display = ls.connected ? "none" : "";
  if (ls.connected) {
    const [teams, issues] = await Promise.all([api("/api/linear/teams"), api("/api/linear/issues?first=15")]);
    document.getElementById("linearTeams").innerHTML = `<table><thead><tr><th>Key</th><th>Name</th></tr></thead><tbody>${teams.map(t => `<tr><td><b>${escapeHtml(t.key)}</b></td><td>${escapeHtml(t.name)}</td></tr>`).join("")}</tbody></table>`;
    document.getElementById("linearIssues").innerHTML = `<table><thead><tr><th>ID</th><th>Title</th><th>State</th></tr></thead><tbody>${issues.map(i => `<tr><td><b>${escapeHtml(i.identifier)}</b></td><td>${escapeHtml((i.title||"").slice(0,60))}</td><td>${escapeHtml(i.state?.name||"")}</td></tr>`).join("")}</tbody></table>`;
  }
  // Notion
  const ns = await api("/api/notion/status");
  document.getElementById("notionStatus").innerHTML = ns.connected ? '<span class="badge success">Connected</span>' : '<span class="muted">Not connected</span>';
  document.getElementById("notionUI").style.display = ns.connected ? "" : "none";
  document.getElementById("notionConnect").style.display = ns.connected ? "none" : "";
  if (ns.connected) loadNotionSearch("");
}
async function loadNotionSearch(q) {
  const results = await api("/api/notion/search?q=" + encodeURIComponent(q || ""));
  const titleOf = (r) => (r.title && Array.isArray(r.title) && r.title[0]?.plain_text) || r.title || r.identifier || "(untitled)";
  document.getElementById("notionResults").innerHTML = `<table><thead><tr><th>Title</th><th>ID</th></tr></thead><tbody>${results.map(r => `<tr><td>${escapeHtml(titleOf(r))}</td><td><code>${escapeHtml(r.id)}</code></td></tr>`).join("")}</tbody></table>`;
}
document.getElementById("linearConnectBtn").addEventListener("click", async () => {
  const apiKey = document.getElementById("linearKey").value.trim(); if (!apiKey) return;
  await api("/api/linear/connect", { method: "POST", body: JSON.stringify({ apiKey }) });
  loadIntegrations();
});
document.getElementById("linearDisconnect").addEventListener("click", async () => { await api("/api/linear/disconnect", { method: "POST" }); loadIntegrations(); });
document.getElementById("notionConnectBtn").addEventListener("click", async () => {
  const token = document.getElementById("notionKey").value.trim(); if (!token) return;
  await api("/api/notion/connect", { method: "POST", body: JSON.stringify({ token }) });
  loadIntegrations();
});
document.getElementById("notionDisconnect").addEventListener("click", async () => { await api("/api/notion/disconnect", { method: "POST" }); loadIntegrations(); });
document.getElementById("notionSearchBtn").addEventListener("click", () => loadNotionSearch(document.getElementById("notionSearchQ").value));
document.querySelector('button[data-tab="integrations"]').addEventListener("click", loadIntegrations);

// Boot
loadMe();
