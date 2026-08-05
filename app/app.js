// PR Copilot for Leads — front-end logic (vanilla JS, no framework).
// ---------------------------------------------------------------------------
// Created by Vinod Kumar K J (AIBS) <vjanardhana@microsoft.com>
// © 2026 Vinod Kumar K J. All rights reserved. Microsoft Global Hackathon 2026.
// ---------------------------------------------------------------------------
// Talks to the backend defined in config.js. Falls back gracefully on error.

const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "";

const el = (id) => document.getElementById(id);
const views = {
  inbox: el("inboxView"),
  detail: el("detailView"),
  settings: el("settingsView"),
};

let currentPR = null; // holds the currently opened PR detail
let currentTab = "today"; // today | active | completed | all
let currentProject = ""; // "" = default project
let currentRepo = ""; // "" = all repos
let appVersion = ""; // set from /api/config

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
  // Global bottom nav: Home is active for inbox/detail; Settings for settings.
  document.querySelectorAll(".nav-btn").forEach((b) => {
    const active = b.dataset.nav === "settings" ? name === "settings" : name !== "settings";
    b.classList.toggle("active", active);
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
  const diffLines = (pr.diff || [])
    .map((l) => `<div class="diff-line ${l.type}">${escapeHtml(l.text)}</div>`)
    .join("");
  const actionBar =
    pr.status === "completed"
      ? `<div class="action-bar">
           <button class="quick-btn review" data-act="cherry-pick">Cherry-pick</button>
           <button class="quick-btn changes" data-act="revert">Revert</button>
         </div>`
      : `<div class="action-bar">
           <button class="quick-btn changes" data-act="reject">Reject</button>
           <button class="quick-btn review" data-act="comment">Comment</button>
           <button class="quick-btn approve" data-act="approve">Approve</button>
         </div>`;

  el("detailContent").innerHTML = `
    <div class="detail-title">${escapeHtml(pr.title)}</div>
    <div class="detail-sub">${escapeHtml(pr.author || "")} · ${pr.filesChanged} files
      &nbsp;<span class="badge ${riskClass(pr.risk)}">${pr.risk.toUpperCase()}</span></div>

    <div class="seg">
      <button class="seg-btn active" data-seg="summary">Summary</button>
      <button class="seg-btn" data-seg="files">Files (${(pr.diff || []).length})</button>
    </div>

    <div id="segSummary">
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
    </div>

    <div id="segFiles" class="hidden">
      <div class="panel">
        <p class="panel-label code">CLEAN DIFF · ${escapeHtml(pr.diffFile || "changes")}</p>
        <div class="diff-box">${diffLines || '<div class="diff-line ctx">No diff available</div>'}</div>
      </div>
    </div>

    ${actionBar}`;

  // Segmented toggle (Summary / Files) — keeps Diff per-PR, not a global tab.
  el("detailContent").querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      el("detailContent").querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const files = b.dataset.seg === "files";
      el("segSummary").classList.toggle("hidden", files);
      el("segFiles").classList.toggle("hidden", !files);
    });
  });

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

// ---- Actions ----
async function openDetail(id) {
  showView("detail", "Pull Request");
  el("detailContent").innerHTML = '<div class="spinner">Loading…</div>';
  try {
    const q = currentProject ? `?project=${encodeURIComponent(currentProject)}` : "";
    const pr = await api(`/api/prs/${id}${q}`);
    renderDetail(pr);
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
    if (nav === "home") {
      showView("inbox", "My Pull Requests");
      loadInbox();
    } else if (nav === "settings") {
      renderSettings();
      showView("settings", "Settings");
    }
  });
});

// ---- Utils ----
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ======================================================================
// Auth (mock Entra flow for the hackathon) + biometric unlock (WebAuthn)
// ======================================================================
// NOTE: This is a hackathon-grade auth SHELL. It demonstrates the real flow —
// Microsoft sign-in, remembered session, biometric/PIN unlock, sign-out/reset —
// without a real Entra app registration yet. Swapping in MSAL later replaces
// signIn()/getSession() only; the rest of the app is unchanged.
// GOVERNANCE: in the real build every ADO call carries the signed-in user's
// token, so Azure DevOps enforces branch policies + approver permissions.

const SESSION_KEY = "prcopilot.session";
const BIO_KEY = "prcopilot.biometric";

// MSAL setup — real Microsoft sign-in when a CLIENT_ID is configured.
const AUTH = (window.APP_CONFIG && window.APP_CONFIG.AUTH) || {};
const AUTH_ENABLED = !!AUTH.CLIENT_ID;
let msal = null;
if (AUTH_ENABLED && window.msal) {
  msal = new window.msal.PublicClientApplication({
    auth: {
      clientId: AUTH.CLIENT_ID,
      authority: `https://login.microsoftonline.com/${AUTH.TENANT || "common"}`,
      redirectUri: location.origin + location.pathname,
    },
    cache: { cacheLocation: "localStorage" },
  });
}

function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function setSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function biometricEnabled() { return localStorage.getItem(BIO_KEY) === "1"; }

// Sign in — REAL Microsoft prompt when configured; demo identity otherwise.
async function signIn() {
  if (AUTH_ENABLED && msal) {
    const result = await msal.loginPopup({ scopes: AUTH.SCOPES || ["User.Read"], prompt: "select_account" });
    const acct = result.account;
    const session = {
      name: acct.name || acct.username,
      email: acct.username,
      initials: initials(acct.name || acct.username),
      homeAccountId: acct.homeAccountId,
      signedInAt: Date.now(),
      real: true,
    };
    setSession(session);
    return session;
  }
  // Demo identity (no Entra app registration configured yet).
  const session = {
    name: "Vinod Kumar K J",
    email: "vjanardhana@microsoft.com",
    initials: "VK",
    signedInAt: Date.now(),
    real: false,
  };
  setSession(session);
  return session;
}

async function signOutAuth() {
  try {
    if (AUTH_ENABLED && msal) {
      const acct = msal.getAllAccounts()[0];
      if (acct) await msal.clearCache({ account: acct });
    }
  } catch {}
}

function initials(name) {
  return (name || "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

// WebAuthn helpers (platform authenticator = Face ID / Touch ID / Windows Hello / PIN)
async function registerBiometric() {
  if (!window.PublicKeyCredential) throw new Error("Biometrics not supported on this device/browser");
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "PR Copilot for Leads" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: (getSession() && getSession().email) || "user",
        displayName: (getSession() && getSession().name) || "user",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { userVerification: "required" },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error("Enrollment cancelled");
  localStorage.setItem(BIO_KEY, "1");
}
async function verifyBiometric() {
  if (!window.PublicKeyCredential) throw new Error("Biometrics not supported");
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      userVerification: "required",
      timeout: 60000,
    },
  });
  return !!assertion;
}

function showSignin() {
  el("signinScreen").classList.remove("hidden");
  el("app").classList.add("hidden");
  const sess = getSession();
  // If a session exists + biometric is on, offer quick unlock.
  if (sess && biometricEnabled()) {
    el("biometricUnlock").classList.remove("hidden");
    el("signinAs").textContent = `Signed in as ${sess.name}`;
    el("msSigninBtn").textContent = "Use a different account";
  } else {
    el("biometricUnlock").classList.add("hidden");
  }
  if (appVersion) el("signinVer").textContent = "v" + appVersion;
}

async function enterApp() {
  el("signinScreen").classList.add("hidden");
  el("app").classList.remove("hidden");
  showView("inbox", "My Pull Requests");
  await loadProjects();
  await loadInbox();
}

// ---- Settings screen ----
function renderSettings() {
  const sess = getSession() || {};
  const bio = biometricEnabled();
  el("settingsContent").innerHTML = `
    <div class="settings-head">Account</div>
    <div class="settings-group">
      <div class="settings-row">
        <div class="avatar">${escapeHtml(sess.initials || initials(sess.name))}</div>
        <div class="label">${escapeHtml(sess.name || "Not signed in")}
          <div class="sub">${escapeHtml(sess.email || "")}</div>
        </div>
      </div>
    </div>

    <div class="settings-head">Security</div>
    <div class="settings-group">
      <div class="settings-row">
        <div class="label">Unlock with Face ID / PIN
          <div class="sub">Skip full sign-in next time on this device</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="bioToggle" ${bio ? "checked" : ""} />
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <div class="settings-head">Permissions</div>
    <div class="settings-group">
      <div class="settings-row">
        <div class="label">Azure DevOps policies apply
          <div class="sub">Approvals, required reviewers &amp; branch policies are enforced by ADO for your account. You can only do what you're allowed to in ADO.</div>
        </div>
      </div>
    </div>

    <div class="settings-head">App</div>
    <div class="settings-group">
      <div class="settings-row">
        <div class="label">Version<div class="sub">PR Copilot for Leads</div></div>
        <div>v${escapeHtml(appVersion || "?")}</div>
      </div>
      <div class="settings-row">
        <div class="label">Check for updates</div>
        <button class="quick-btn review" id="checkUpdateBtn">Check</button>
      </div>
      <div class="settings-row">
        <div class="label">Share this app
          <div class="sub">Send the install link to a colleague</div>
        </div>
        <button class="quick-btn approve" id="shareBtn">Share</button>
      </div>
    </div>

    <button class="danger-btn" id="signoutBtn">Sign out &amp; reset this device</button>

    <div class="credit">
      Created by <b>Vinod Kumar K J</b> · AIBS<br />
      <span>&lt;vjanardhana@microsoft.com&gt;</span><br />
      <span class="credit-copy">© 2026 Vinod Kumar K J. All rights reserved.</span>
    </div>`;

  el("bioToggle").addEventListener("change", async (e) => {
    if (e.target.checked) {
      try {
        await registerBiometric();
        toast("Biometric unlock enabled");
      } catch (err) {
        e.target.checked = false;
        toast(err.message);
      }
    } else {
      localStorage.removeItem(BIO_KEY);
      toast("Biometric unlock disabled");
    }
  });
  el("checkUpdateBtn").addEventListener("click", checkForUpdate);
  el("shareBtn").addEventListener("click", shareApp);
  el("signoutBtn").addEventListener("click", () => {
    if (!confirm("Sign out and remove this device's saved session, default, and biometric?")) return;
    signOutAuth();
    clearSession();
    localStorage.removeItem(BIO_KEY);
    clearDefaults();
    toast("Signed out");
    showSignin();
  });
}

// ---- Version / update ----
async function loadVersion() {
  try {
    const cfg = await api(`/api/config`);
    appVersion = cfg.version || "";
    const known = localStorage.getItem("prcopilot.version");
    if (known && known !== appVersion) showUpdateBanner();
    localStorage.setItem("prcopilot.version", appVersion);
  } catch {
    /* ignore */
  }
}
async function checkForUpdate() {
  try {
    const v = await api(`/api/version`);
    if (v.version && v.version !== appVersion) {
      showUpdateBanner();
    } else {
      toast("You're on the latest version (v" + (v.version || appVersion) + ")");
    }
  } catch (e) {
    toast("Update check failed");
  }
}
function showUpdateBanner() {
  el("updateBanner").classList.remove("hidden");
}

// ---- Share the app (native share sheet → WhatsApp, Teams, email, etc.) ----
async function shareApp() {
  const installUrl = location.origin + "/install.html";
  const shareData = {
    title: "PR Copilot for Leads",
    text:
      "PR Copilot for Leads — review, triage & approve Azure DevOps pull requests from your phone. " +
      "Scan or open to install (Microsoft employees). Created by Vinod Kumar K J.",
    url: installUrl,
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData); // opens WhatsApp/Teams/email/etc.
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return; // user cancelled
  }
  // Fallback: WhatsApp web link + copy to clipboard.
  try {
    await navigator.clipboard.writeText(shareData.text + " " + installUrl);
    toast("Install link copied to clipboard");
  } catch {
    /* ignore */
  }
  const wa = "https://wa.me/?text=" + encodeURIComponent(shareData.text + " " + installUrl);
  window.open(wa, "_blank");
}el("updateBtn") && el("updateBtn").addEventListener("click", async () => {
  // Clear caches + unregister SW so the newest build loads.
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {}
  location.reload(true);
});

// ---- Sign-in wiring ----
el("msSigninBtn").addEventListener("click", async () => {
  el("msSigninBtn").textContent = "Signing in…";
  try {
    await signIn();
    await enterApp();
  } catch (e) {
    toast("Sign-in failed: " + e.message);
    el("msSigninBtn").textContent = "Sign in with Microsoft";
  }
});
el("biometricBtn").addEventListener("click", async () => {
  try {
    const ok = await verifyBiometric();
    if (ok) await enterApp();
    else toast("Unlock failed");
  } catch (e) {
    toast("Unlock failed: " + e.message);
  }
});
el("settingsBtn").addEventListener("click", () => {
  renderSettings();
  showView("settings", "Settings");
});

// ---- Start ----
(async function start() {
  await loadVersion();
  const sess = getSession();
  if (sess && !biometricEnabled()) {
    // Remembered session, no biometric → go straight in.
    await enterApp();
  } else {
    showSignin();
  }
})();
