// Service layer — abstracts MOCK vs LIVE Azure DevOps behind one shape the
// front-end consumes. Toggle with env: ADO_MODE=live  (default: mock).
//
//   mock → uses api/mock-data.js (no Azure, works offline)
//   live → uses api/liveAdo.js (read-only, your cached Git credential)

const { PRS } = require("./mock-data");
const live = require("./liveAdo");
const { scoreRisk, deriveChecks, trianglePriority, isNoise, daysAgo } = require("./risk");
const xpp = require("./xppChecks");

const MODE = (process.env.ADO_MODE || "mock").toLowerCase();

// ---------- shape helpers ----------
function shortFrom(pr, risk, count) {
  const age = Math.floor(daysAgo(pr.creationDate));
  const bits = [];
  if (count != null) bits.push(`${count} files`);
  if (age >= 1) bits.push(`${age}d old`);
  if (risk === "high") bits.push("review carefully");
  return bits.join(" · ") || "recently opened";
}

// ---------- MOCK ----------
function mockList() {
  return PRS.map((p) => ({
    id: p.id,
    title: p.title,
    author: p.author,
    risk: p.risk,
    priority: { high: 90, medium: 50, low: 20 }[p.risk],
    reasons: [p.summaryShort],
    repo: "Contoso.FnO",
    status: "active",
    summaryShort: p.summaryShort,
    checks: p.checks,
    ageDays: 1,
  }));
}
function mockDetail(id) {
  const p = PRS.find((x) => x.id === Number(id));
  if (!p) return null;
  // Run the real X++ analyzer over the mock diff text so the feature demos offline.
  const source = (p.diff || [])
    .map((l) => l.text.replace(/^[+\-]\s?/, ""))
    .join("\n");
  const codeFindings = xpp.analyzeSource(p.diffFile || "mock.xpp", source).map((f) => ({ ...f, file: p.diffFile }));
  const codeSummary = xpp.summarize(codeFindings);
  return {
    id: p.id,
    title: p.title,
    author: p.author,
    risk: p.risk,
    reasons: [p.summaryShort],
    filesChanged: p.filesChanged,
    summaryShort: p.summaryShort,
    summary: p.summary,
    checks: p.checks,
    diffFile: p.diffFile,
    diff: p.diff,
    codeFindings,
    codeSummary,
    status: "active",
    url: "#",
  };
}

// ---------- LIVE ----------
function mapLiveListItem(pr, risk, reasons, checks) {
  return {
    id: pr.pullRequestId,
    title: pr.title,
    author: pr.createdBy && pr.createdBy.displayName,
    risk,
    priority: trianglePriority(pr, risk),
    reasons,
    repo: pr.repository && pr.repository.name,
    status: pr.status,
    isDraft: !!pr.isDraft,
    summaryShort: shortFrom(pr, risk),
    checks,
    ageDays: Math.floor(daysAgo(pr.creationDate)),
    url: pr.repository
      ? `https://dev.azure.com/${live.ORG}/${encodeURIComponent(
          pr.repository.project ? pr.repository.project.name : ""
        )}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`
      : "#",
  };
}

async function liveList(status, project, repoId) {
  const prs = await live.listPullRequests(status, 50, project, repoId);
  // For the list we score risk from title/branch only (cheap, no per-PR calls).
  return prs.map((pr) => {
    const hints = [pr.title, pr.sourceRefName, pr.targetRefName].filter(Boolean);
    const { risk, reasons } = scoreRisk(pr, hints);
    const checks = deriveChecks(pr);
    return mapLiveListItem(pr, risk, reasons, checks);
  });
}

async function liveDetail(id, project) {
  const pr = await live.getPullRequest(id, project);
  if (!pr) return null;
  const repoId = pr.repository && pr.repository.id;
  let changePaths = [];
  let diff = [];
  let diffFile = "";
  let entries = [];
  try {
    const changes = await live.getPullRequestChanges(repoId, id, project);
    entries = changes.changeEntries || [];
    changePaths = entries.map((c) => (c.item && c.item.path) || "").filter(Boolean);
    const meaningful = changePaths.filter((p) => !isNoise(p));
    diffFile = meaningful[0] || changePaths[0] || "changes";
    // Lightweight "clean diff": show the changed file list (hide noise),
    // with change type. Real line-level diff can be added later.
    diff = entries
      .filter((c) => !isNoise((c.item && c.item.path) || ""))
      .slice(0, 40)
      .map((c) => ({
        type: c.changeType === "delete" ? "del" : c.changeType === "add" ? "add" : "ctx",
        text: `${(c.changeType || "edit").padEnd(6)} ${(c.item && c.item.path) || ""}`,
      }));
  } catch (e) {
    diff = [{ type: "ctx", text: "Diff unavailable: " + e.message }];
  }

  // ---- X++ best-practice / performance analysis ----
  // Fetch content of a few changed X++ files at the PR's source commit and scan.
  let codeFindings = [];
  let codeSummary = { counts: { high: 0, medium: 0, low: 0 }, total: 0, top: [] };
  try {
    const sourceCommit =
      (pr.lastMergeSourceCommit && pr.lastMergeSourceCommit.commitId) ||
      (pr.lastMergeCommit && pr.lastMergeCommit.commitId);
    if (sourceCommit && repoId) {
      const xppEntries = entries
        .filter((c) => c.changeType !== "delete" && xpp.isXppFile((c.item && c.item.path) || ""))
        .slice(0, 6); // cap for speed
      for (const c of xppEntries) {
        const p = c.item.path;
        try {
          const content = await live.getFileContent(repoId, p, sourceCommit, project);
          const found = xpp.analyzeSource(p, content).map((f) => ({ ...f, file: p }));
          codeFindings.push(...found);
        } catch (_) {
          /* skip unreadable file */
        }
      }
      codeSummary = xpp.summarize(codeFindings);
    }
  } catch (_) {
    /* analysis is best-effort */
  }

  const { risk, reasons } = scoreRisk(pr, changePaths.length ? changePaths : [pr.title]);
  const checks = deriveChecks(pr);
  const meaningfulCount = changePaths.filter((p) => !isNoise(p)).length;

  // Escalate risk if the code scan found high-severity issues.
  let finalRisk = risk;
  const finalReasons = reasons.slice();
  if (codeSummary.counts.high > 0) {
    finalRisk = "high";
    finalReasons.unshift(`${codeSummary.counts.high} high-severity code issue(s)`);
  } else if (codeSummary.counts.medium > 0 && finalRisk === "low") {
    finalRisk = "medium";
    finalReasons.unshift(`${codeSummary.counts.medium} code issue(s)`);
  }

  return {
    id: pr.pullRequestId,
    title: pr.title,
    author: pr.createdBy && pr.createdBy.displayName,
    risk: finalRisk,
    reasons: finalReasons,
    filesChanged: meaningfulCount || changePaths.length,
    summaryShort: shortFrom(pr, finalRisk, meaningfulCount || changePaths.length),
    summary:
      (pr.description ? pr.description.trim().slice(0, 400) : "") ||
      `${finalRisk.toUpperCase()} risk. ${finalReasons.join(", ")}. Opened ${Math.floor(
        daysAgo(pr.creationDate)
      )} day(s) ago by ${pr.createdBy && pr.createdBy.displayName}.`,
    checks,
    diffFile,
    diff,
    codeFindings,
    codeSummary,
    status: pr.status,
    url: pr.repository
      ? `https://dev.azure.com/${live.ORG}/_git/${encodeURIComponent(
          pr.repository.name
        )}/pullrequest/${pr.pullRequestId}`
      : "#",
    commentDraft:
      finalRisk === "high"
        ? `This PR touches ${finalReasons.join(", ")}. Please address the flagged code issues, add/confirm test coverage, and rebase onto the target branch before it can be approved.`
        : `Thanks — looks reasonable. Please confirm ${finalReasons[0]} is intended and that checks are green before merge.`,
  };
}

// ---------- public API ----------
async function getList(status = "active", project, repo) {
  if (MODE === "live") return liveList(status, project, repo);
  return mockList();
}
async function getDetail(id, project) {
  if (MODE === "live") return liveDetail(id, project);
  return mockDetail(id);
}
async function getProjects() {
  if (MODE === "live") return live.listProjects();
  return [{ id: "mock", name: "Contoso F&O (mock)" }];
}
async function getRepos(project) {
  if (MODE === "live") return live.listRepos(project);
  return [{ id: "mock", name: "Contoso.FnO (mock)" }];
}
function defaults() {
  return { org: live.ORG, project: live.PROJECT, mode: MODE, allowWrite: MODE === "live" && live.ALLOW_WRITE };
}

// Revert / cherry-pick a PR onto a target branch.
async function revertPr(id, project, ontoRef) {
  if (MODE !== "live") return { ok: true, preview: true, action: "revert", id, ontoRef, note: "mock" };
  const pr = await live.getPullRequest(id, project);
  const repoId = pr.repository && pr.repository.id;
  const target = ontoRef || pr.targetRefName || "refs/heads/main";
  if (!live.ALLOW_WRITE) {
    return { ok: true, preview: true, action: "revert", id, ontoRef: target, note: "read-only: set ADO_ALLOW_WRITE=true to execute" };
  }
  const r = await live.revertPullRequest(repoId, id, target, project);
  return { ok: true, action: "revert", id, ontoRef: target, operation: r };
}

async function cherryPickPr(id, project, ontoRef) {
  if (MODE !== "live") return { ok: true, preview: true, action: "cherry-pick", id, ontoRef, note: "mock" };
  const pr = await live.getPullRequest(id, project);
  const repoId = pr.repository && pr.repository.id;
  if (!ontoRef) return { ok: false, error: "Target branch required for cherry-pick" };
  const target = ontoRef.startsWith("refs/") ? ontoRef : `refs/heads/${ontoRef}`;
  if (!live.ALLOW_WRITE) {
    return { ok: true, preview: true, action: "cherry-pick", id, ontoRef: target, note: "read-only: set ADO_ALLOW_WRITE=true to execute" };
  }
  const r = await live.cherryPickPullRequest(repoId, id, target, project);
  return { ok: true, action: "cherry-pick", id, ontoRef: target, operation: r };
}

function commentDraftFor(detail) {
  return detail.commentDraft || "Please address the review notes before this can be approved.";
}

module.exports = { MODE, getList, getDetail, getProjects, getRepos, defaults, commentDraftFor, revertPr, cherryPickPr };
