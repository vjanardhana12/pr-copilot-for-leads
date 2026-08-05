// Live Azure DevOps client (READ-ONLY for now).
//
// Auth: reuses the Git Credential Manager token already on this machine
// (the same one `git push` uses for carlsberggroup) via `git credential fill`.
// No PAT is stored, nothing is written to ADO in this module.
//
// Config (env, with sensible Carlsberg defaults for the hackathon):
//   ADO_ORG      e.g. "carlsberggroup"
//   ADO_PROJECT  e.g. "1760-SmartCore-HUB"
//   ADO_HOST     default "dev.azure.com"

const { execFile } = require("child_process");

const ORG = process.env.ADO_ORG || "carlsberggroup";
const PROJECT = process.env.ADO_PROJECT || "1760-SmartCore-HUB";
const HOST = process.env.ADO_HOST || "dev.azure.com";
const ORG_BASE = `https://${HOST}/${ORG}/_apis`;
function projectBase(project) {
  return `https://${HOST}/${ORG}/${encodeURIComponent(project || PROJECT)}/_apis`;
}

let _authHeader = null;

// Pull the cached credential for the org via Git Credential Manager.
function getGitCredential() {
  return new Promise((resolve, reject) => {
    const input = `protocol=https\nhost=${HOST}\npath=${ORG}\n\n`;
    const child = execFile("git", ["credential", "fill"], (err, stdout) => {
      if (err) return reject(err);
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith("password="));
      if (!line) return reject(new Error("No cached Git credential for " + ORG));
      resolve(line.replace(/^password=/, "").trim());
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

async function authHeader() {
  if (_authHeader) return _authHeader;
  const token = await getGitCredential();
  const basic = Buffer.from(":" + token).toString("base64");
  _authHeader = { Authorization: `Basic ${basic}` };
  return _authHeader;
}

async function adoGet(pathAndQuery, project) {
  const headers = await authHeader();
  const base = project === "__org__" ? ORG_BASE : projectBase(project);
  const res = await fetch(`${base}${pathAndQuery}`, { headers });
  if (res.status === 401 || res.status === 203) {
    _authHeader = null; // force refresh next time
    throw new Error(`ADO auth failed (${res.status}) — credential may have expired`);
  }
  if (!res.ok) throw new Error(`ADO ${res.status} on ${pathAndQuery}`);
  return res.json();
}

// List projects in the org.
async function listProjects() {
  const data = await adoGet(`/projects?$top=200&api-version=7.0`, "__org__");
  return (data.value || [])
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// List repositories in a project.
async function listRepos(project) {
  const data = await adoGet(`/git/repositories?api-version=7.0`, project);
  return (data.value || [])
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// status: "active" | "completed" | "abandoned" | "all"
// Optional project + repoId to scope the query.
async function listPullRequests(status = "active", top = 50, project, repoId) {
  const statusQ = status === "all" ? "all" : status;
  const scope = repoId
    ? `/git/repositories/${repoId}/pullrequests`
    : `/git/pullrequests`;
  const data = await adoGet(
    `${scope}?searchCriteria.status=${statusQ}&$top=${top}&api-version=7.0`,
    project
  );
  return data.value || [];
}

async function getPullRequest(prId, project) {
  // Cross-repo lookup: PR by id (project-scoped).
  return adoGet(`/git/pullrequests/${prId}?api-version=7.0`, project);
}

async function getPullRequestThreads(repoId, prId, project) {
  const data = await adoGet(
    `/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.0`,
    project
  );
  return data.value || [];
}

// Latest iteration changes (the file list / diff summary).
async function getPullRequestChanges(repoId, prId, project) {
  const iters = await adoGet(
    `/git/repositories/${repoId}/pullRequests/${prId}/iterations?api-version=7.0`,
    project
  );
  const last = (iters.value || []).slice(-1)[0];
  if (!last) return { changeEntries: [] };
  return adoGet(
    `/git/repositories/${repoId}/pullRequests/${prId}/iterations/${last.id}/changes?api-version=7.0`,
    project
  );
}

module.exports = {
  ORG,
  PROJECT,
  listProjects,
  listRepos,
  listPullRequests,
  getPullRequest,
  getPullRequestThreads,
  getPullRequestChanges,
};
