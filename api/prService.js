// Service layer — abstracts MOCK vs LIVE Azure DevOps behind one shape the
// front-end consumes. Toggle with env: ADO_MODE=live  (default: mock).
//
//   mock → uses api/mock-data.js (no Azure, works offline)
//   live → uses api/liveAdo.js (read-only, your cached Git credential)

const { PRS } = require("./mock-data");
const live = require("./liveAdo");
const { scoreRisk, deriveChecks, trianglePriority, isNoise, daysAgo } = require("./risk");

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
  try {
    const changes = await live.getPullRequestChanges(repoId, id, project);
    const entries = changes.changeEntries || [];
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

  const { risk, reasons } = scoreRisk(pr, changePaths.length ? changePaths : [pr.title]);
  const checks = deriveChecks(pr);
  const meaningfulCount = changePaths.filter((p) => !isNoise(p)).length;

  return {
    id: pr.pullRequestId,
    title: pr.title,
    author: pr.createdBy && pr.createdBy.displayName,
    risk,
    reasons,
    filesChanged: meaningfulCount || changePaths.length,
    summaryShort: shortFrom(pr, risk, meaningfulCount || changePaths.length),
    summary:
      (pr.description ? pr.description.trim().slice(0, 400) : "") ||
      `${risk.toUpperCase()} risk. ${reasons.join(", ")}. Opened ${Math.floor(
        daysAgo(pr.creationDate)
      )} day(s) ago by ${pr.createdBy && pr.createdBy.displayName}.`,
    checks,
    diffFile,
    diff,
    status: pr.status,
    url: pr.repository
      ? `https://dev.azure.com/${live.ORG}/_git/${encodeURIComponent(
          pr.repository.name
        )}/pullrequest/${pr.pullRequestId}`
      : "#",
    commentDraft:
      risk === "high"
        ? `This PR touches ${reasons.join(", ")}. Please add/confirm test coverage and rebase onto the target branch before it can be approved.`
        : `Thanks — looks reasonable. Please confirm ${reasons[0]} is intended and that checks are green before merge.`,
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
  return { org: live.ORG, project: live.PROJECT, mode: MODE };
}
function commentDraftFor(detail) {
  return detail.commentDraft || "Please address the review notes before this can be approved.";
}

module.exports = { MODE, getList, getDetail, getProjects, getRepos, defaults, commentDraftFor };
