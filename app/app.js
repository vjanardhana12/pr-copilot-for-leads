// PR Copilot for Leads — front-end logic (vanilla JS, no framework).
// Talks to the backend defined in config.js. Falls back gracefully on error.

const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "";

const el = (id) => document.getElementById(id);
const views = {
  inbox: el("inboxView"),
  detail: el("detailView"),
  diff: el("diffView"),
};

let currentPR = null; // holds the currently opened PR detail
let currentTab = "today"; // today | active | completed | all
let currentProject = ""; // "" = default project
let currentRepo = ""; // "" = all repos

// ---- API helpers ----
async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---- View switching ----
function showView(name, title) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
  if (title) el("topbarTitle").textContent = title;
  el("backBtn").classList.toggle("hidden", name === "inbox");
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.nav === (name === "detail" ? "actions" : name));
  });
  window.scrollTo(0, 0);
}

function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 2200);
}

// ---- Rendering ----
function riskClass(risk) {
  return { low: "low", medium: "medium", high: "high" }[risk] || "low";
}
function riskAction(risk) {
  return {
    low: `<button class="quick-btn approve" data-approve>Approve</button>`,
    medium: `<button class="quick-btn review">Review</button>`,
    high: `<button class="quick-btn changes">Changes</button>`,
  }[risk];
}

function renderInbox(prs) {
  const list = el("prList");
  const high = prs.filter((p) => p.risk === "high").length;
  const label = currentTab === "today" ? "needs you today" : currentTab;
  el("inboxSubtitle").textContent = `${prs.length} ${label} · ${high} high risk`;
  list.innerHTML = "";
  if (!prs.length) {
    list.innerHTML = `<div class="spinner">Nothing here 🎉</div>`;
    return;
  }
  prs.forEach((pr) => {
    const li = document.createElement("li");
    li.className = `pr-card ${riskClass(pr.risk)}`;
    const reasons = (pr.reasons || [])
      .slice(0, 3)
      .map((r) => `<span class="reason ${pr.risk === "high" ? "hot" : ""}">${escapeHtml(r)}</span>`)
      .join("");
    const statusPill = pr.isDraft
      ? `<span class="pr-pill draft">DRAFT</span>`
      : pr.status && pr.status !== "active"
      ? `<span class="pr-pill ${pr.status}">${pr.status.toUpperCase()}</span>`
      : "";
    const prio = currentTab === "today" && pr.priority != null
      ? `<span class="prio">priority ${pr.priority}</span>`
      : "";
    li.innerHTML = `
      <div class="pr-head">
        <div style="flex:1">
          <p class="pr-title">${escapeHtml(pr.title)}${statusPill}</p>
          <p class="pr-meta">
            <span class="pr-repo">${escapeHtml(pr.repo || "")}</span>
            ${pr.summaryShort ? " · " + escapeHtml(pr.summaryShort) : ""}
          </p>
          <span class="badge ${riskClass(pr.risk)}">${pr.risk.toUpperCase()} RISK</span>
        </div>
        ${pr.status === "active" ? riskAction(pr.risk) : ""}
      </div>
      <div class="reasons">${reasons}</div>
      <div class="dots">
        <span class="dot ${pr.checks && pr.checks.build ? "ok" : "bad"}"></span><span class="dot-label">build</span>
        <span class="dot ${pr.checks && pr.checks.labels ? "ok" : "warn"}"></span><span class="dot-label">labels</span>
        <span class="dot ${pr.checks && pr.checks.rebase ? "ok" : "warn"}"></span><span class="dot-label">rebase</span>
        ${prio}
      </div>
      <div class="pr-author" style="margin-top:6px">${escapeHtml(pr.author || "")}</div>`;
    li.addEventListener("click", (e) => {
      if (e.target.hasAttribute("data-approve")) {
        e.stopPropagation();
        approve(pr.id);
        return;
      }
      openDetail(pr.id);
    });
    list.appendChild(li);
  });
}

function renderDetail(pr) {
  currentPR = pr;
  const checks = [
    ["build", "Build", pr.checks.build],
    ["labels", "Labels correct", pr.checks.labels],
    ["rebase", "No rebase needed", pr.checks.rebase],
  ];
  el("detailContent").innerHTML = `
    <div class="detail-title">${escapeHtml(pr.title)}</div>
    <div class="detail-sub">${escapeHtml(pr.author || "")} · ${pr.filesChanged} files
      &nbsp;<span class="badge ${riskClass(pr.risk)}">${pr.risk.toUpperCase()}</span></div>

    <div class="panel">
      <p class="panel-label ai">AI SUMMARY</p>
      <p>${escapeHtml(pr.summary)}</p>
      ${
        (pr.reasons || []).length
          ? `<div class="reasons">${pr.reasons
              .map((r) => `<span class="reason ${pr.risk === "high" ? "hot" : ""}">${escapeHtml(r)}</span>`)
              .join("")}</div>`
          : ""
      }
    </div>

    <div class="panel">
      <p class="panel-label checks">PRECHECKS</p>
      ${checks
        .map(
          ([k, label, ok]) =>
            `<div class="check-row"><span class="dot ${ok ? "ok" : "bad"}"></span>${label}</div>`
        )
        .join("")}
    </div>

    ${renderCodeReview(pr)}

    ${
      pr.status === "completed"
        ? `<div class="action-bar">
             <button class="quick-btn review" data-act="cherry-pick">Cherry-pick</button>
             <button class="quick-btn changes" data-act="revert">Revert</button>
           </div>`
        : `<div class="action-bar">
             <button class="quick-btn changes" data-act="reject">Reject</button>
             <button class="quick-btn review" data-act="comment">Comment</button>
             <button class="quick-btn approve" data-act="approve">Approve</button>
           </div>`
    }`;

  el("detailContent").querySelectorAll("[data-act]").forEach((b) => {
    b.addEventListener("click", () => handleAction(pr.id, b.dataset.act));
  });
}

function renderCodeReview(pr) {
  const s = pr.codeSummary;
  const findings = pr.codeFindings || [];
  if (!s || !s.total) {
    return `
    <div class="panel">
      <p class="panel-label code">X++ CODE REVIEW</p>
      <div class="check-row"><span class="dot ok"></span>No best-practice or performance issues detected</div>
    </div>`;
  }
  const chip = (n, cls, label) =>
    n ? `<span class="sev-chip ${cls}">${n} ${label}</span>` : "";
  const items = s.top
    .map(
      (f) => `
      <div class="finding ${f.severity}">
        <div class="finding-head">
          <span class="sev-dot ${f.severity}"></span>
          <span class="finding-msg">${escapeHtml(f.message)}</span>
          <span class="finding-cat">${escapeHtml(f.category)}</span>
        </div>
        ${f.file ? `<div class="finding-file">${escapeHtml(shortPath(f.file))}${f.line ? ":" + f.line : ""}</div>` : ""}
        ${f.snippet ? `<code class="finding-snippet">${escapeHtml(f.snippet)}</code>` : ""}
        <div class="finding-hint">${escapeHtml(f.hint)}</div>
      </div>`
    )
    .join("");
  return `
    <div class="panel">
      <p class="panel-label code">X++ CODE REVIEW</p>
      <div class="sev-summary">
        ${chip(s.counts.high, "high", "high")}
        ${chip(s.counts.medium, "medium", "medium")}
        ${chip(s.counts.low, "low", "low")}
        <span class="sev-total">${s.total} finding${s.total > 1 ? "s" : ""}</span>
      </div>
      ${items}
    </div>`;
}

function shortPath(p) {
  const parts = String(p).split("/");
  return parts.length > 2 ? ".../" + parts.slice(-2).join("/") : p;
}

function renderDiff(pr) {
  const lines = (pr.diff || [])
    .map((l) => `<div class="diff-line ${l.type}">${escapeHtml(l.text)}</div>`)
    .join("");
  el("diffContent").innerHTML = `
    <div class="diff-file">${escapeHtml(pr.diffFile || "changes")}</div>
    <div class="diff-box">${lines || '<div class="diff-line ctx">No diff available</div>'}</div>`;
}

// ---- Actions ----
async function openDetail(id) {
  showView("detail", "Pull Request");
  el("detailContent").innerHTML = '<div class="spinner">Loading…</div>';
  try {
    const q = currentProject ? `?project=${encodeURIComponent(currentProject)}` : "";
    const pr = await api(`/api/prs/${id}${q}`);
    renderDetail(pr);
    renderDiff(pr);
  } catch (e) {
    el("detailContent").innerHTML = `<div class="spinner">Couldn't load PR (${e.message})</div>`;
  }
}

async function approve(id) {
  try {
    await api(`/api/prs/${id}/approve`, { method: "POST" });
    toast("✓ Approved");
    loadInbox();
  } catch (e) {
    toast("Approve failed: " + e.message);
  }
}

async function handleAction(id, act) {
  if (act === "approve") return approve(id);
  if (act === "reject") {
    try {
      await api(`/api/prs/${id}/reject`, { method: "POST" });
      toast("Changes requested");
      showView("inbox", "My Pull Requests");
      loadInbox();
    } catch (e) {
      toast("Failed: " + e.message);
    }
    return;
  }
  if (act === "comment") {
    try {
      const draft = await api(`/api/prs/${id}/comment-draft`);
      const text = prompt("AI-drafted comment (edit if needed):", draft.text);
      if (text == null) return;
      await api(`/api/prs/${id}/comment`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      toast("Comment sent to developer");
    } catch (e) {
      toast("Failed: " + e.message);
    }
  }
  if (act === "revert") {
    if (!confirm("Create a revert PR for this merged PR?")) return;
    try {
      const q = currentProject ? `?project=${encodeURIComponent(currentProject)}` : "";
      const r = await api(`/api/prs/${id}/revert${q}`, { method: "POST", body: JSON.stringify({}) });
      toast(r.preview ? "Revert preview (read-only)" : "Revert PR created");
    } catch (e) {
      toast("Revert failed: " + e.message);
    }
  }
  if (act === "cherry-pick") {
    const target = prompt("Cherry-pick onto which branch? (e.g. release/2026.07 or main)", "main");
    if (!target) return;
    try {
      const q = currentProject ? `?project=${encodeURIComponent(currentProject)}` : "";
      const r = await api(`/api/prs/${id}/cherry-pick${q}`, {
        method: "POST",
        body: JSON.stringify({ ontoRef: target }),
      });
      toast(r.preview ? `Cherry-pick preview → ${target} (read-only)` : `Cherry-picked → ${target}`);
    } catch (e) {
      toast("Cherry-pick failed: " + e.message);
    }
  }
}

// ---- Load ----
async function loadInbox() {
  el("inboxSubtitle").textContent = "Loading…";
  el("prList").innerHTML = "";
  try {
    const q = new URLSearchParams();
    if (currentProject) q.set("project", currentProject);
    if (currentRepo) q.set("repo", currentRepo);
    let path;
    if (currentTab === "today") {
      path = `/api/today?${q.toString()}`;
    } else {
      q.set("status", currentTab);
      path = `/api/prs?${q.toString()}`;
    }
    const prs = await api(path);
    renderInbox(prs);
  } catch (e) {
    el("inboxSubtitle").textContent = "Couldn't reach backend (" + e.message + ")";
  }
}

// ---- Selectors (project / repo) ----
const DEFAULTS_KEY = "prcopilot.defaults";
function getSavedDefaults() {
  try {
    return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "null");
  } catch {
    return null;
  }
}
function saveDefaults(project, repo, repoName) {
  localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ project, repo, repoName }));
}
function clearDefaults() {
  localStorage.removeItem(DEFAULTS_KEY);
}
function refreshStar() {
  const d = getSavedDefaults();
  const btn = el("defaultBtn");
  const isDefault = d && d.project === currentProject && (d.repo || "") === (currentRepo || "");
  btn.classList.toggle("is-default", !!isDefault);
  btn.textContent = isDefault ? "★" : "☆";
  btn.title = isDefault ? "This is your default (tap to clear)" : "Set current project/repo as default";
}

async function loadProjects() {
  const sel = el("projectSelect");
  try {
    const cfg = await api(`/api/config`);
    const saved = getSavedDefaults();
    // Prefer the saved default project; fall back to server default.
    currentProject = (saved && saved.project) || cfg.project || "";
    const projects = await api(`/api/projects`);
    sel.innerHTML = projects
      .map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`)
      .join("");
    // Only apply saved project if it's still in the list.
    if (currentProject && [...sel.options].some((o) => o.value === currentProject)) {
      sel.value = currentProject;
    } else {
      currentProject = sel.value;
    }
    await loadRepos();
    refreshStar();
  } catch (e) {
    // In mock mode / no access, hide selectors gracefully.
    document.querySelector(".selectors").style.display = "none";
  }
}

async function loadRepos() {
  const sel = el("repoSelect");
  try {
    const repos = await api(`/api/repos?project=${encodeURIComponent(currentProject)}`);
    sel.innerHTML =
      `<option value="">All repositories (${repos.length})</option>` +
      repos.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("");
    // Apply saved default repo only when it belongs to the current project.
    const saved = getSavedDefaults();
    if (saved && saved.project === currentProject && saved.repo && [...sel.options].some((o) => o.value === saved.repo)) {
      sel.value = saved.repo;
      currentRepo = saved.repo;
    } else {
      currentRepo = "";
    }
    refreshStar();
  } catch (e) {
    sel.innerHTML = `<option value="">All repositories</option>`;
  }
}

// ---- Nav wiring ----
el("backBtn").addEventListener("click", () => {
  showView("inbox", "My Pull Requests");
  loadInbox();
});
el("refreshBtn").addEventListener("click", loadInbox);

// Tabs (Today / Active / Completed / All)
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    currentTab = t.dataset.tab;
    loadInbox();
  });
});

// Project / repo selectors
el("projectSelect").addEventListener("change", async (e) => {
  currentProject = e.target.value;
  await loadRepos();
  refreshStar();
  loadInbox();
});
el("repoSelect").addEventListener("change", (e) => {
  currentRepo = e.target.value;
  refreshStar();
  loadInbox();
});

// Set / clear default project+repo
el("defaultBtn").addEventListener("click", () => {
  const d = getSavedDefaults();
  const isDefault = d && d.project === currentProject && (d.repo || "") === (currentRepo || "");
  if (isDefault) {
    clearDefaults();
    toast("Default cleared");
  } else {
    const repoName = el("repoSelect").selectedOptions[0]
      ? el("repoSelect").selectedOptions[0].textContent
      : "";
    saveDefaults(currentProject, currentRepo, repoName);
    toast(
      currentRepo
        ? `Default set: ${currentProject} / ${repoName}`
        : `Default set: ${currentProject} (all repos)`
    );
  }
  refreshStar();
});
document.querySelectorAll(".nav-btn").forEach((b) => {
  b.addEventListener("click", () => {
    const nav = b.dataset.nav;
    if (nav === "inbox") {
      showView("inbox", "My Pull Requests");
      loadInbox();
    } else if (nav === "diff") {
      if (!currentPR) return toast("Open a PR first");
      showView("diff", "Clean diff");
    } else if (nav === "actions") {
      if (!currentPR) return toast("Open a PR first");
      showView("detail", "Pull Request");
    }
  });
});

// ---- Utils ----
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Start
showView("inbox", "My Pull Requests");
loadProjects().then(loadInbox);
