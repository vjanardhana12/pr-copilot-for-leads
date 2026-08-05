// Per-user Azure DevOps client — the SHIPPABLE path.
//
// Unlike liveAdo.js (which uses this machine's cached git credential for dev),
// this module makes every call AS THE SIGNED-IN USER, using the OAuth access
// token their browser obtained via MSAL. Nothing is hardcoded to an org:
// the user's own accessible organizations/projects/repos are discovered.
//
// This is what makes the app multi-user + multi-project ("ship to any project"):
//   - each person authenticates with their own Microsoft/ADO account
//   - ADO enforces their permissions + branch policies server-side
//   - they see only what they're allowed to see
//
// The token is passed per-request from the front-end as a Bearer header and is
// NEVER stored on the server.

const VSSPS = "https://app.vssps.visualstudio.com/_apis";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

async function get(url, token) {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`ADO auth ${res.status}`);
    e.status = res.status;
    throw e;
  }
  if (!res.ok) throw new Error(`ADO ${res.status} on ${url}`);
  return res.json();
}

async function post(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = new Error(`ADO ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// The signed-in user's profile id (needed to list their organizations).
async function getProfileId(token) {
  const p = await get(`${VSSPS}/profile/profiles/me?api-version=7.0`, token);
  return p.id;
}

// All Azure DevOps organizations the user belongs to.
async function listOrgs(token) {
  const memberId = await getProfileId(token);
  const data = await get(`${VSSPS}/accounts?memberId=${memberId}&api-version=7.0`, token);
  return (data.value || [])
    .map((a) => ({ id: a.accountId, name: a.accountName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function orgBase(org) {
  return `https://dev.azure.com/${encodeURIComponent(org)}/_apis`;
}
function projBase(org, project) {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`;
}

async function listProjects(token, org) {
  const data = await get(`${orgBase(org)}/projects?$top=200&api-version=7.0`, token);
  return (data.value || [])
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listRepos(token, org, project) {
  const data = await get(`${projBase(org, project)}/git/repositories?api-version=7.0`, token);
  return (data.value || [])
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listPullRequests(token, org, status = "active", top = 50, project, repoId) {
  const statusQ = status === "all" ? "all" : status;
  const scope = repoId
    ? `${projBase(org, project)}/git/repositories/${repoId}/pullrequests`
    : project
    ? `${projBase(org, project)}/git/pullrequests`
    : `${orgBase(org)}/git/pullrequests`;
  const data = await get(`${scope}?searchCriteria.status=${statusQ}&$top=${top}&api-version=7.0`, token);
  return data.value || [];
}

async function getPullRequest(token, org, prId, project) {
  const base = project ? projBase(org, project) : orgBase(org);
  return get(`${base}/git/pullrequests/${prId}?api-version=7.0`, token);
}

async function getPullRequestChanges(token, org, repoId, prId, project) {
  const base = projBase(org, project);
  const iters = await get(`${base}/git/repositories/${repoId}/pullRequests/${prId}/iterations?api-version=7.0`, token);
  const last = (iters.value || []).slice(-1)[0];
  if (!last) return { changeEntries: [] };
  return get(`${base}/git/repositories/${repoId}/pullRequests/${prId}/iterations/${last.id}/changes?api-version=7.0`, token);
}

async function getFileContent(token, org, repoId, filePath, commitId, project) {
  const base = projBase(org, project);
  const q = new URLSearchParams({
    path: filePath,
    "versionDescriptor.versionType": "commit",
    "versionDescriptor.version": commitId,
    includeContent: "true",
    "api-version": "7.0",
  });
  const res = await fetch(`${base}/git/repositories/${repoId}/items?${q.toString()}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`ADO item ${res.status}`);
  const data = await res.json();
  return data.content || "";
}

// ---- write actions (as the user; ADO enforces approver permission) ----
async function setVote(token, org, project, repoId, prId, reviewerId, vote) {
  const url = `${projBase(org, project)}/git/repositories/${repoId}/pullRequests/${prId}/reviewers/${reviewerId}?api-version=7.0`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ vote }),
  });
  if (!res.ok) { const e = new Error(`ADO ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

async function addComment(token, org, project, repoId, prId, content) {
  const url = `${projBase(org, project)}/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.0`;
  return post(url, token, { comments: [{ content }], status: "active" });
}

async function revertPullRequest(token, org, project, repoId, prId, ontoRef) {
  const url = `${projBase(org, project)}/git/repositories/${repoId}/reverts?api-version=7.0`;
  return post(url, token, {
    generatedRefName: `refs/heads/revert/pr-${prId}-${Date.now()}`,
    ontoRefName: ontoRef,
    source: { pullRequestId: Number(prId) },
  });
}

async function cherryPickPullRequest(token, org, project, repoId, prId, ontoRef) {
  const url = `${projBase(org, project)}/git/repositories/${repoId}/cherryPicks?api-version=7.0`;
  return post(url, token, {
    generatedRefName: `refs/heads/cherry-pick/pr-${prId}-${Date.now()}`,
    ontoRefName: ontoRef,
    source: { pullRequestId: Number(prId) },
  });
}

module.exports = {
  listOrgs,
  listProjects,
  listRepos,
  listPullRequests,
  getPullRequest,
  getPullRequestChanges,
  getFileContent,
  setVote,
  addComment,
  revertPullRequest,
  cherryPickPullRequest,
};
