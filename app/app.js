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
  el("inboxSubtitle").textContent = `${prs.length} active · ${high} high risk`;
  list.innerHTML = "";
  prs.forEach((pr) => {
    const li = document.createElement("li");
    li.className = `pr-card ${riskClass(pr.risk)}`;
    li.innerHTML = `
      <div class="pr-head">
        <div>
          <p class="pr-title">${escapeHtml(pr.title)}</p>
          <p class="pr-meta">${escapeHtml(pr.summaryShort)}</p>
          <span class="badge ${riskClass(pr.risk)}">${pr.risk.toUpperCase()} RISK</span>
        </div>
        ${riskAction(pr.risk)}
      </div>
      <div class="dots">
        <span class="dot ${pr.checks.build ? "ok" : "bad"}"></span><span class="dot-label">build</span>
        <span class="dot ${pr.checks.labels ? "ok" : "warn"}"></span><span class="dot-label">labels</span>
        <span class="dot ${pr.checks.rebase ? "ok" : "warn"}"></span><span class="dot-label">rebase</span>
        <span class="pr-author" style="margin-left:auto">${escapeHtml(pr.author)}</span>
      </div>`;
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
    <div class="detail-sub">${escapeHtml(pr.author)} · ${pr.filesChanged} files
      &nbsp;<span class="badge ${riskClass(pr.risk)}">${pr.risk.toUpperCase()}</span></div>

    <div class="panel">
      <p class="panel-label ai">AI SUMMARY</p>
      <p>${escapeHtml(pr.summary)}</p>
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

    <div class="action-bar">
      <button class="quick-btn changes" data-act="reject">Reject</button>
      <button class="quick-btn review" data-act="comment">Comment</button>
      <button class="quick-btn approve" data-act="approve">Approve</button>
    </div>`;

  el("detailContent").querySelectorAll("[data-act]").forEach((b) => {
    b.addEventListener("click", () => handleAction(pr.id, b.dataset.act));
  });
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
    const pr = await api(`/api/prs/${id}`);
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
}

// ---- Load ----
async function loadInbox() {
  el("inboxSubtitle").textContent = "Loading…";
  try {
    const prs = await api(`/api/prs`);
    renderInbox(prs);
  } catch (e) {
    el("inboxSubtitle").textContent = "Couldn't reach backend (" + e.message + ")";
  }
}

// ---- Nav wiring ----
el("backBtn").addEventListener("click", () => {
  showView("inbox", "My Pull Requests");
  loadInbox();
});
el("refreshBtn").addEventListener("click", loadInbox);
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
loadInbox();
