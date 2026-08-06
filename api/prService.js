// Service layer — one shape the front-end consumes, three data sources:
//
//   mock       → api/mock-data.js (no Azure, works offline)
//   dev-cred   → api/liveAdo.js (this machine's cached git credential; ADO_MODE=live)
//   user-token → api/adoProxy.js (SHIPPABLE: the signed-in user's own OAuth token)
//
// The user-token path is what makes the app multi-user + multi-project: when a
// request carries a Bearer token (from the front-end's MSAL sign-in) + an org,
// every ADO call is made AS THAT USER, and ADO enforces their permissions and
// branch policies. Nothing is hardcoded to an org.
//
// Selection per request (see pickAdapter): token+org → proxy; else ADO_MODE=live
// → dev-cred; else mock.

const { PRS } = require("./mock-data");
const live = require("./liveAdo");
const proxy = require("./adoProxy");
const { scoreRisk, deriveChecks, trianglePriority, isNoise, daysAgo, urgencyBucket } = require("./risk");
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
  return PRS.map((p) => {
    const priority = { high: 90, medium: 50, low: 20 }[p.risk];
    return {
      id: p.id,
      title: p.title,
      author: p.author,
      risk: p.risk,
      priority,
      urgency: urgencyBucket(priority),
      reasons: [p.summaryShort],
      repo: "Contoso.FnO",
      status: "active",
      summaryShort: p.summaryShort,
      checks: p.checks,
      ageDays: 1,
    };
  });
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

// ---------- adapters (uniform interface over dev-cred vs user-token) ----------
function liveAdapter() {
  return {
    orgName: live.ORG,
    allowWrite: live.ALLOW_WRITE,
    listPullRequests: (status, top, project, repoId) => live.listPullRequests(status, top, project, repoId),
    getPullRequest: (id, project) => live.getPullRequest(id, project),
    getPullRequestChanges: (repoId, id, project) => live.getPullRequestChanges(repoId, id, project),
    getFileContent: (repoId, path, commit, project) => live.getFileContent(repoId, path, commit, project),
    listProjects: () => live.listProjects(),
    listRepos: (project) => live.listRepos(project),
    revert: (repoId, id, ref, project) => live.revertPullRequest(repoId, id, ref, project),
    cherry: (repoId, id, ref, project) => live.cherryPickPullRequest(repoId, id, ref, project),
    vote: null, // dev-cred is read-only for votes/comments
    comment: null,
  };
}
function proxyAdapter(ctx) {
  const { token, org } = ctx;
  return {
    orgName: org,
    allowWrite: true, // ADO still enforces the user's actual permissions
    listPullRequests: (status, top, project, repoId) =>
      proxy.listPullRequests(token, org, status, top, project, repoId),
    getPullRequest: (id, project) => proxy.getPullRequest(token, org, id, project),
    getPullRequestChanges: (repoId, id, project) => proxy.getPullRequestChanges(token, org, repoId, id, project),
    getFileContent: (repoId, path, commit, project) => proxy.getFileContent(token, org, repoId, path, commit, project),
    listProjects: () => proxy.listProjects(token, org),
    listRepos: (project) => proxy.listRepos(token, org, project),
    revert: (repoId, id, ref, project) => proxy.revertPullRequest(token, org, project, repoId, id, ref),
    cherry: (repoId, id, ref, project) => proxy.cherryPickPullRequest(token, org, project, repoId, id, ref),
    vote: (project, repoId, id, reviewerId, v) => proxy.setVote(token, org, project, repoId, id, reviewerId, v),
    comment: (project, repoId, id, content) => proxy.addComment(token, org, project, repoId, id, content),
  };
}
// Choose source for THIS request. ctx = { token, org } from the signed-in user.
function pickAdapter(ctx) {
  if (ctx && ctx.token && ctx.org) return proxyAdapter(ctx);
  if (MODE === "live") return liveAdapter();
  return null; // → mock
}

// ---------- generic mappers (work for both dev-cred and user-token) ----------
function mapListItem(pr, risk, reasons, checks, orgName) {
  const projName = pr.repository && pr.repository.project ? pr.repository.project.name : "";
  const priority = trianglePriority(pr, risk);
  return {
    id: pr.pullRequestId,
    title: pr.title,
    author: pr.createdBy && pr.createdBy.displayName,
    risk,
    priority,
    urgency: urgencyBucket(priority),
    reasons,
    repo: pr.repository && pr.repository.name,
    status: pr.status,
    isDraft: !!pr.isDraft,
    summaryShort: shortFrom(pr, risk),
    checks,
    ageDays: Math.floor(daysAgo(pr.creationDate)),
    url: pr.repository
      ? `https://dev.azure.com/${orgName}/${encodeURIComponent(projName)}/_git/${encodeURIComponent(
          pr.repository.name
        )}/pullrequest/${pr.pullRequestId}`
      : "#",
  };
}

async function buildList(adapter, status, project, repoId) {
  const prs = await adapter.listPullRequests(status, 50, project, repoId);
  return prs.map((pr) => {
    const hints = [pr.title, pr.sourceRefName, pr.targetRefName].filter(Boolean);
    const { risk, reasons } = scoreRisk(pr, hints);
    const checks = deriveChecks(pr);
    return mapListItem(pr, risk, reasons, checks, adapter.orgName);
  });
}

async function buildDetail(adapter, id, project) {
  const pr = await adapter.getPullRequest(id, project);
  if (!pr) return null;
  const repoId = pr.repository && pr.repository.id;
  let changePaths = [];
  let diff = [];
  let diffFile = "";
  let entries = [];
  try {
    const changes = await adapter.getPullRequestChanges(repoId, id, project);
    entries = changes.changeEntries || [];
    changePaths = entries.map((c) => (c.item && c.item.path) || "").filter(Boolean);
    const meaningful = changePaths.filter((p) => !isNoise(p));
    diffFile = meaningful[0] || changePaths[0] || "changes";
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
  let codeFindings = [];
  let codeSummary = { counts: { high: 0, medium: 0, low: 0 }, total: 0, top: [] };
  try {
    const sourceCommit =
      (pr.lastMergeSourceCommit && pr.lastMergeSourceCommit.commitId) ||
      (pr.lastMergeCommit && pr.lastMergeCommit.commitId);
    if (sourceCommit && repoId) {
      const xppEntries = entries
        .filter((c) => c.changeType !== "delete" && xpp.isXppFile((c.item && c.item.path) || ""))
        .slice(0, 6);
      for (const c of xppEntries) {
        const p = c.item.path;
        try {
          const content = await adapter.getFileContent(repoId, p, sourceCommit, project);
          const found = xpp.analyzeSource(p, content).map((f) => ({ ...f, file: p }));
          codeFindings.push(...found);
        } catch (_) {}
      }
      codeSummary = xpp.summarize(codeFindings);
    }
  } catch (_) {}

  const { risk, reasons } = scoreRisk(pr, changePaths.length ? changePaths : [pr.title]);
  const checks = deriveChecks(pr);
  const meaningfulCount = changePaths.filter((p) => !isNoise(p)).length;

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
    repoId,
    targetRefName: pr.targetRefName,
    url: pr.repository
      ? `https://dev.azure.com/${adapter.orgName}/_git/${encodeURIComponent(
          pr.repository.name
        )}/pullrequest/${pr.pullRequestId}`
      : "#",
    commentDraft:
      finalRisk === "high"
        ? `This PR touches ${finalReasons.join(", ")}. Please address the flagged code issues, add/confirm test coverage, and rebase onto the target branch before it can be approved.`
        : `Thanks — looks reasonable. Please confirm ${finalReasons[0]} is intended and that checks are green before merge.`,
  };
}

// ---------- public API (ctx = { token, org } for the signed-in user) ----------
async function getOrgs(ctx) {
  if (ctx && ctx.token) return proxy.listOrgs(ctx.token);
  if (MODE === "live") return [{ id: "dev", name: live.ORG }];
  return [{ id: "mock", name: "Contoso (mock)" }];
}
async function getList(ctx, status = "active", project, repo) {
  const a = pickAdapter(ctx);
  if (!a) return mockList();
  return buildList(a, status, project, repo);
}
async function getDetail(ctx, id, project) {
  const a = pickAdapter(ctx);
  if (!a) return mockDetail(id);
  return buildDetail(a, id, project);
}
async function getProjects(ctx) {
  const a = pickAdapter(ctx);
  if (!a) return [{ id: "mock", name: "Contoso F&O (mock)" }];
  return a.listProjects();
}
async function getRepos(ctx, project) {
  const a = pickAdapter(ctx);
  if (!a) return [{ id: "mock", name: "Contoso.FnO (mock)" }];
  return a.listRepos(project);
}
function defaults(ctx) {
  const a = pickAdapter(ctx);
  return {
    org: a ? a.orgName : (MODE === "live" ? live.ORG : ""),
    project: MODE === "live" ? live.PROJECT : "",
    mode: ctx && ctx.token ? "user" : MODE,
    allowWrite: a ? !!a.allowWrite : false,
    signedIn: !!(ctx && ctx.token),
  };
}

// Revert / cherry-pick a PR onto a target branch.
async function revertPr(ctx, id, project, ontoRef) {
  const a = pickAdapter(ctx);
  if (!a) return { ok: true, preview: true, action: "revert", id, ontoRef, note: "mock" };
  const pr = await a.getPullRequest(id, project);
  const repoId = pr.repository && pr.repository.id;
  const target = ontoRef || pr.targetRefName || "refs/heads/main";
  if (!a.allowWrite) {
    return { ok: true, preview: true, action: "revert", id, ontoRef: target, note: "read-only in dev mode" };
  }
  const r = await a.revert(repoId, id, target, project);
  return { ok: true, action: "revert", id, ontoRef: target, operation: r };
}
async function cherryPickPr(ctx, id, project, ontoRef) {
  const a = pickAdapter(ctx);
  if (!a) return { ok: true, preview: true, action: "cherry-pick", id, ontoRef, note: "mock" };
  if (!ontoRef) return { ok: false, error: "Target branch required for cherry-pick" };
  const pr = await a.getPullRequest(id, project);
  const repoId = pr.repository && pr.repository.id;
  const target = ontoRef.startsWith("refs/") ? ontoRef : `refs/heads/${ontoRef}`;
  if (!a.allowWrite) {
    return { ok: true, preview: true, action: "cherry-pick", id, ontoRef: target, note: "read-only in dev mode" };
  }
  const r = await a.cherry(repoId, id, target, project);
  return { ok: true, action: "cherry-pick", id, ontoRef: target, operation: r };
}
// Approve / reject / comment as the signed-in user (proxy mode only).
async function voteOnPr(ctx, id, project, vote) {
  const a = pickAdapter(ctx);
  if (!a || !a.vote) return { ok: true, preview: true, note: "read-only (sign in to act)" };
  const pr = await a.getPullRequest(id, project);
  const repoId = pr.repository && pr.repository.id;
  // "me" reviewer id via the PR's reviewer list would be resolved client-side;
  // ADO accepts the special reviewer id of the caller through the me alias.
  const reviewerId = (pr.createdBy && pr.createdBy.id) || "me";
  const r = await a.vote(project, repoId, id, ctx.userId || reviewerId, vote);
  return { ok: true, vote, operation: r };
}
async function commentOnPr(ctx, id, project, text) {
  const a = pickAdapter(ctx);
  if (!a || !a.comment) return { ok: true, preview: true, note: "read-only (sign in to act)" };
  const pr = await a.getPullRequest(id, project);
  const repoId = pr.repository && pr.repository.id;
  const r = await a.comment(project, repoId, id, text);
  return { ok: true, operation: r };
}

function commentDraftFor(detail) {
  return detail.commentDraft || "Please address the review notes before this can be approved.";
}

module.exports = {
  MODE,
  getOrgs,
  getList,
  getDetail,
  getProjects,
  getRepos,
  defaults,
  commentDraftFor,
  revertPr,
  cherryPickPr,
  voteOnPr,
  commentOnPr,
};
