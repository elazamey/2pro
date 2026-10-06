/* 2pro dashboard - vanilla JS, no build step.
   All calls go to relative /api/* URLs so the app works behind any proxy. */

const state = {
  repos: [],
  repo: null,       // "owner/name"
  tab: "overview",
  timer: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ------------------------------------------------------------------ helpers */

async function api(path, options = {}) {
  const opts = Object.assign({ headers: {} }, options);
  if (opts.body && typeof opts.body === "object") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  let response;
  try {
    response = await fetch(path, opts);
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }
  let data = null;
  try { data = await response.json(); } catch (_) { /* no body */ }
  if (!response.ok) {
    const detail = (data && (data.detail || data.message)) || response.statusText;
    throw new Error(detail);
  }
  return data;
}

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function timeAgo(iso) {
  if (!iso) return "";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const units = [["m", 60], ["h", 3600], ["d", 86400], ["mo", 2592000], ["y", 31536000]];
  let value = seconds, label = "s";
  for (const [name, size] of units) {
    if (value >= size) { label = name; value = Math.floor(seconds / size); }
  }
  return `${value}${label} ago`;
}

function duration(seconds) {
  if (seconds == null) return "";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function toast(message, kind = "") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  $("#toasts").appendChild(node);
  setTimeout(() => node.remove(), 5000);
}

function banner(message, kind = "") {
  const el = $("#banner");
  if (!message) { el.classList.add("hidden"); return; }
  el.textContent = message;
  el.className = `banner ${kind}`;
}

function setLoading(selector, text = "Loading…") {
  $(selector).innerHTML = `<div class="spinner">${escapeHtml(text)}</div>`;
}

/* ------------------------------------------------------------------- markdown */

function renderMarkdown(md) {
  const lines = escapeHtml(md || "").split("\n");
  const out = [];
  let inList = false, inTable = false;
  const inline = (text) => text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/@([a-zA-Z0-9-]+)/g, '<a href="https://github.com/$1" target="_blank" rel="noopener">@$1</a>');

  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const closeTable = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|/.test(line)) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (/^-+$/.test(cells.join("").replace(/[|: -]/g, "")) || cells.every((c) => /^:?-+:?$/.test(c))) {
        out.push("<thead><tr>" + cells.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>");
        inTable = true;
        continue;
      }
      if (!inTable) out.push("<table>");
      out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      continue;
    }
    closeTable();
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^---+$/.test(line)) { closeList(); out.push("<hr>"); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeTable();
  return out.join("\n");
}

/* ------------------------------------------------------------------- startup */

async function boot() {
  wireEvents();
  try {
    const [health, me] = await Promise.all([api("/api/health"), api("/api/me")]);
    $("#userchip").innerHTML =
      `${me.avatar_url ? `<img src="${escapeHtml(me.avatar_url)}" alt="">` : ""}` +
      `<span>${escapeHtml(me.login)}</span><span class="muted">· ${escapeHtml(health.host)}</span>`;
  } catch (err) {
    banner(`Cannot reach GitHub: ${err.message}\nSet GITHUB_TOKEN (or run \`gh auth login\` / \`2pro auth login\`) and restart \`2pro serve\`.`);
    $("#userchip").textContent = "not authenticated";
    $("#repo-list").innerHTML = '<div class="empty">No credential available.</div>';
    return;
  }
  await loadRepos();
  updateRateLimit();
  setInterval(updateRateLimit, 60000);
}

async function updateRateLimit() {
  try {
    const rl = await api("/api/rate-limit");
    const pct = rl.limit ? (rl.remaining / rl.limit) * 100 : 0;
    const fill = $("#rl-fill");
    fill.style.width = `${Math.max(2, pct)}%`;
    fill.style.background = pct > 40 ? "var(--green)" : pct > 15 ? "var(--amber)" : "var(--red)";
    $("#rl-text").textContent = `${rl.remaining}/${rl.limit} left`;
    $("#ratelimit").title = `Resets in ${rl.reset_in}s`;
  } catch (_) { /* ignore */ }
}

/* --------------------------------------------------------------------- repos */

async function loadRepos(query = "") {
  const list = $("#repo-list");
  if (!query) list.innerHTML = '<div class="spinner">Loading repositories…</div>';
  try {
    const data = await api(`/api/repos?per_page=50${query ? `&q=${encodeURIComponent(query)}` : ""}`);
    state.repos = data.items || [];
    renderRepos();
    if (!state.repo && state.repos.length) selectRepo(state.repos[0].full_name);
  } catch (err) {
    list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderRepos(filter = "") {
  const list = $("#repo-list");
  const needle = filter.toLowerCase();
  const items = state.repos.filter((r) => r.full_name.toLowerCase().includes(needle));
  if (!items.length) {
    list.innerHTML = '<div class="empty">No repositories found.</div>';
    return;
  }
  list.innerHTML = items.map((r) => `
    <div class="repo-item ${r.full_name === state.repo ? "active" : ""}" data-repo="${escapeHtml(r.full_name)}">
      <div class="name">${escapeHtml(r.full_name)}</div>
      <div class="meta">
        ${r.private ? "🔒 private" : "🌍 public"}
        ${r.language ? `<span>${escapeHtml(r.language)}</span>` : ""}
        <span>★ ${r.stars}</span>
        ${r.pushed_at ? `<span>${timeAgo(r.pushed_at)}</span>` : ""}
      </div>
    </div>`).join("");
  $$(".repo-item").forEach((el) => el.addEventListener("click", () => selectRepo(el.dataset.repo)));
}

function selectRepo(fullName) {
  state.repo = fullName;
  $$(".repo-item").forEach((el) => el.classList.toggle("active", el.dataset.repo === fullName));
  const repo = state.repos.find((r) => r.full_name === fullName);
  $("#repo-title").textContent = fullName;
  $("#repo-sub").textContent = repo
    ? [repo.description, repo.language, `default: ${repo.default_branch}`,
       repo.archived ? "archived" : ""].filter(Boolean).join(" · ")
    : "";
  const link = $("#btn-github");
  link.href = `https://github.com/${fullName}`;
  link.hidden = false;
  refresh();
}

function refresh() {
  if (!state.repo) return;
  loadOverview();
  loadIssues();
  loadPulls();
  loadRuns();
  if (state.tab === "digest") loadDigest();
}

/* ------------------------------------------------------------------ overview */

async function loadOverview() {
  const pane = $("#overview");
  pane.innerHTML = '<div class="spinner">Loading overview…</div>';
  try {
    const [issues, pulls, runs] = await Promise.all([
      api(`/api/repos/${state.repo}/issues?state=open&limit=100`),
      api(`/api/repos/${state.repo}/pulls?state=open&limit=100`),
      api(`/api/repos/${state.repo}/runs?limit=10`),
    ]);
    const failing = (runs.items || []).filter((r) => ["failure", "timed_out", "startup_failure"].includes(r.conclusion)).length;
    const success = (runs.items || []).filter((r) => r.conclusion === "success").length;
    const last = (runs.items || [])[0];
    const cards = [
      ["Open issues", issues.items.length, "excluding pull requests"],
      ["Open pull requests", pulls.items.length, `${pulls.items.filter((p) => p.draft).length} draft`],
      ["Recent CI runs", (runs.items || []).length, `${success} green · ${failing} red`],
      ["Last run", last ? `${last.icon} ${last.conclusion || last.status}` : "—",
        last ? `${last.name || "workflow"} · ${timeAgo(last.created_at)}` : "no runs yet"],
    ];
    pane.innerHTML = cards.map(([label, value, sub]) => `
      <div class="card">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
        <div class="sub">${escapeHtml(sub || "")}</div>
      </div>`).join("");
  } catch (err) {
    pane.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

/* -------------------------------------------------------------------- issues */

async function loadIssues() {
  const stateFilter = $("#issue-state").value;
  setLoading("#issues");
  try {
    const data = await api(`/api/repos/${state.repo}/issues?state=${stateFilter}&limit=50`);
    const items = data.items || [];
    if (!items.length) { $("#issues").innerHTML = '<div class="empty">No issues.</div>'; return; }
    $("#issues").innerHTML = items.map((i) => `
      <div class="row">
        <div class="icon">${i.state === "open" ? "🟢" : "🟣"}</div>
        <div class="main">
          <div class="title"><a href="${escapeHtml(i.html_url)}" target="_blank" rel="noopener">${escapeHtml(i.title)}</a>
            <span class="num">#${i.number}</span></div>
          <div class="meta">
            <span>by ${escapeHtml(i.user || "?")}</span>
            <span>${timeAgo(i.created_at)}</span>
            <span>${i.comments} comment(s)</span>
            ${i.labels.map((l) => `<span class="label-pill">${escapeHtml(l)}</span>`).join("")}
          </div>
        </div>
        <div class="actions">
          <button class="btn small" data-act="comment" data-number="${i.number}">Comment</button>
          ${i.state === "open" ? `<button class="btn small danger" data-act="close" data-number="${i.number}">Close</button>` : ""}
        </div>
      </div>`).join("");
    $$('#issues [data-act="close"]').forEach((b) => b.addEventListener("click", () => closeIssue(b.dataset.number)));
    $$('#issues [data-act="comment"]').forEach((b) => b.addEventListener("click", () => commentDialog(b.dataset.number)));
  } catch (err) {
    $("#issues").innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function closeIssue(number) {
  openModal({
    title: `Close issue #${number}`,
    body: `<div><label>Comment (optional)</label><textarea class="input" id="m-comment" placeholder="Closing because…"></textarea></div>
           <div><label>Reason</label>
             <select class="input" id="m-reason">
               <option value="completed">completed</option>
               <option value="not_planned">not planned</option>
             </select></div>`,
    okText: "Close issue",
    onOk: async () => {
      await api(`/api/repos/${state.repo}/issues/${number}/close`, {
        method: "POST",
        body: { reason: $("#m-reason").value, comment: $("#m-comment").value || undefined },
      });
      toast(`Issue #${number} closed`, "ok");
      loadIssues();
    },
  });
}

function commentDialog(number) {
  openModal({
    title: `Comment on #${number}`,
    body: `<div><label>Comment (Markdown supported)</label><textarea class="input" id="m-body" placeholder="Leave a comment…"></textarea></div>`,
    okText: "Post comment",
    onOk: async () => {
      const body = $("#m-body").value.trim();
      if (!body) throw new Error("Comment cannot be empty");
      await api(`/api/repos/${state.repo}/issues/${number}/comments`, { method: "POST", body: { body } });
      toast(`Comment posted on #${number}`, "ok");
    },
  });
}

function newIssueDialog() {
  openModal({
    title: "New issue",
    body: `<div><label>Title</label><input class="input" id="m-title" placeholder="Short summary" /></div>
           <div><label>Body (Markdown)</label><textarea class="input" id="m-body" placeholder="Details, steps to reproduce…"></textarea></div>
           <div><label>Labels (comma separated)</label><input class="input" id="m-labels" placeholder="bug, good first issue" /></div>`,
    okText: "Create issue",
    onOk: async () => {
      const title = $("#m-title").value.trim();
      if (!title) throw new Error("Title is required");
      const labels = $("#m-labels").value.split(",").map((s) => s.trim()).filter(Boolean);
      const issue = await api(`/api/repos/${state.repo}/issues`, {
        method: "POST", body: { title, body: $("#m-body").value, labels },
      });
      toast(`Opened #${issue.number}`, "ok");
      loadIssues();
    },
  });
}

/* ---------------------------------------------------------------------- PRs */

async function loadPulls() {
  const stateFilter = $("#pr-state").value;
  setLoading("#pulls");
  try {
    const data = await api(`/api/repos/${state.repo}/pulls?state=${stateFilter}&limit=50`);
    const items = data.items || [];
    if (!items.length) { $("#pulls").innerHTML = '<div class="empty">No pull requests.</div>'; return; }
    $("#pulls").innerHTML = items.map((p) => `
      <div class="row">
        <div class="icon">${p.draft ? "📝" : p.state === "merged" ? "🟣" : "🟢"}</div>
        <div class="main">
          <div class="title"><a href="${escapeHtml(p.html_url)}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a>
            <span class="num">#${p.number}</span></div>
          <div class="meta">
            <span>${escapeHtml(p.head || "?")} → ${escapeHtml(p.base || "?")}</span>
            <span>+${p.additions}/-${p.deletions} in ${p.changed_files} file(s)</span>
            <span>by ${escapeHtml(p.user || "?")}</span>
            <span>${timeAgo(p.updated_at)}</span>
            ${p.draft ? '<span class="label-pill">draft</span>' : ""}
            ${p.state === "merged" ? '<span class="label-pill">merged</span>' : ""}
          </div>
        </div>
        <div class="actions">
          <button class="btn small" data-act="review" data-number="${p.number}">Review</button>
          ${p.state === "open" ? `<button class="btn small primary" data-act="merge" data-number="${p.number}">Merge</button>` : ""}
        </div>
      </div>`).join("");
    $$('#pulls [data-act="merge"]').forEach((b) => b.addEventListener("click", () => mergeDialog(b.dataset.number)));
    $$('#pulls [data-act="review"]').forEach((b) => b.addEventListener("click", () => reviewPull(b.dataset.number)));
  } catch (err) {
    $("#pulls").innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function mergeDialog(number) {
  openModal({
    title: `Merge pull request #${number}`,
    body: `<div><label>Merge method</label>
             <select class="input" id="m-method">
               <option value="merge">Create a merge commit</option>
               <option value="squash">Squash and merge</option>
               <option value="rebase">Rebase and merge</option>
             </select></div>`,
    okText: "Merge",
    onOk: async () => {
      const result = await api(`/api/repos/${state.repo}/pulls/${number}/merge`, {
        method: "POST", body: { method: $("#m-method").value },
      });
      toast(result.message || `Merged #${number}`, "ok");
      loadPulls();
    },
  });
}

async function reviewPull(number) {
  toast(`Reviewing #${number}…`);
  try {
    const report = await api(`/api/repos/${state.repo}/pulls/${number}/review?post=false`, { method: "POST" });
    openModal({
      title: `Automated review · #${number} — ${report.verdict}`,
      body: `<div class="markdown">${renderMarkdown(report.markdown)}</div>`,
      okText: report.errors.length ? "Post review anyway" : "Post review comment",
      onOk: async () => {
        await api(`/api/repos/${state.repo}/pulls/${number}/review?post=true`, { method: "POST" });
        toast("Review posted", "ok");
      },
    });
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ------------------------------------------------------------------ actions */

async function loadRuns() {
  const status = $("#run-status").value;
  setLoading("#runs");
  try {
    const data = await api(`/api/repos/${state.repo}/runs?limit=25${status ? `&status=${status}` : ""}`);
    const items = data.items || [];
    if (!items.length) { $("#runs").innerHTML = '<div class="empty">No workflow runs.</div>'; return; }
    $("#runs").innerHTML = items.map((r) => {
      const dot = r.conclusion === "success" ? "dot-success"
        : ["failure", "timed_out", "startup_failure"].includes(r.conclusion) ? "dot-failure"
        : r.status === "completed" ? "dot-neutral" : "dot-pending";
      return `
      <div class="row">
        <div class="icon"><span class="state-dot ${dot}"></span></div>
        <div class="main">
          <div class="title"><a href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener">${escapeHtml(r.display_title || r.name || "run")}</a>
            <span class="num">#${r.run_number}</span></div>
          <div class="meta">
            <span>${escapeHtml(r.name || "workflow")}</span>
            <span>${escapeHtml(r.event || "")}</span>
            <span>${escapeHtml(r.branch || "")}@${escapeHtml(r.sha || "")}</span>
            <span>${r.conclusion || r.status}</span>
            <span>${duration(r.duration)}</span>
            <span>${timeAgo(r.created_at)}</span>
            ${r.actor ? `<span>by ${escapeHtml(r.actor)}</span>` : ""}
          </div>
        </div>
        <div class="actions">
          <button class="btn small" data-act="rerun" data-id="${r.id}">Re-run</button>
          <button class="btn small" data-act="rerun-failed" data-id="${r.id}">Re-run failed</button>
          ${r.status !== "completed" ? `<button class="btn small danger" data-act="cancel" data-id="${r.id}">Cancel</button>` : ""}
        </div>
      </div>`;
    }).join("");
    $$('#runs [data-act="rerun"]').forEach((b) => b.addEventListener("click", () => runAction(b.dataset.id, "rerun")));
    $$('#runs [data-act="rerun-failed"]').forEach((b) => b.addEventListener("click", () => runAction(b.dataset.id, "rerun", true)));
    $$('#runs [data-act="cancel"]').forEach((b) => b.addEventListener("click", () => runAction(b.dataset.id, "cancel")));
  } catch (err) {
    $("#runs").innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

async function runAction(runId, action, failedOnly = false) {
  try {
    if (action === "rerun") {
      await api(`/api/repos/${state.repo}/runs/${runId}/rerun${failedOnly ? "?failed_only=true" : ""}`, { method: "POST" });
      toast(`Re-run requested${failedOnly ? " (failed jobs)" : ""}`, "ok");
    } else {
      await api(`/api/repos/${state.repo}/runs/${runId}/cancel`, { method: "POST" });
      toast("Cancel requested", "ok");
    }
    setTimeout(loadRuns, 2000);
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ------------------------------------------------------------------- digest */

async function loadDigest() {
  const days = $("#digest-days").value;
  setLoading("#digest", "Building digest…");
  try {
    const data = await api(`/api/repos/${state.repo}/digest?days=${days}`);
    $("#digest").innerHTML = renderMarkdown(data.markdown);
  } catch (err) {
    $("#digest").innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

/* -------------------------------------------------------------------- modal */

let modalHandler = null;

function openModal({ title, body, okText = "Submit", onOk }) {
  modalHandler = onOk;
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal-ok").textContent = okText;
  $("#modal").classList.remove("hidden");
}

function closeModal() {
  $("#modal").classList.add("hidden");
  modalHandler = null;
}

/* ------------------------------------------------------------------- events */

function wireEvents() {
  $$("#tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$("#tabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
      $$(".pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === tab.dataset.tab));
      state.tab = tab.dataset.tab;
      if (state.tab === "digest") loadDigest();
    });
  });

  $("#btn-refresh").addEventListener("click", () => { updateRateLimit(); refresh(); });
  $("#btn-new-issue").addEventListener("click", newIssueDialog);
  $("#btn-digest").addEventListener("click", loadDigest);
  $("#issue-state").addEventListener("change", loadIssues);
  $("#pr-state").addEventListener("change", loadPulls);
  $("#run-status").addEventListener("change", loadRuns);

  let searchTimer = null;
  $("#repo-search").addEventListener("input", (event) => {
    const value = event.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (value.length >= 2 && !value.includes("/")) loadRepos(value);
      else renderRepos(value);
    }, 400);
  });

  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (event) => { if (event.target === $("#modal")) closeModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

  $("#modal-ok").addEventListener("click", async () => {
    if (!modalHandler) return closeModal();
    const button = $("#modal-ok");
    button.disabled = true;
    try {
      await modalHandler();
      closeModal();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      button.disabled = false;
    }
  });

  $("#auto-refresh").addEventListener("change", (event) => {
    clearInterval(state.timer);
    if (event.target.checked) state.timer = setInterval(loadRuns, 30000);
  });
}

document.addEventListener("DOMContentLoaded", boot);
