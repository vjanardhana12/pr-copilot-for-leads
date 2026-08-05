// STUB — real Azure DevOps integration goes here (replaces mock-data for live PRs).
//
// This is where the backend calls the Azure DevOps REST API. Nothing here runs
// yet; it documents the exact calls the mock server will be swapped to use.
//
// Auth options:
//   - Hackathon/dev: a Personal Access Token (PAT) in an env var (server-side only!).
//   - Production: the signed-in user's Entra ID token (same pattern as the D365
//     Warehouse Management app) passed from the PWA and exchanged for an ADO token.
//
// Config comes from environment variables — see .env.example.

const ORG = process.env.ADO_ORG;         // e.g. "mcaps-microsoft"
const PROJECT = process.env.ADO_PROJECT;  // e.g. "your-project"
const PAT = process.env.ADO_PAT;          // dev only; never commit this

const BASE = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;

function authHeader() {
  // PAT is sent as Basic auth with an empty username.
  const token = Buffer.from(":" + PAT).toString("base64");
  return { Authorization: `Basic ${token}` };
}

// GET active pull requests assigned to / created by the lead.
// https://learn.microsoft.com/rest/api/azure/devops/git/pull-requests/get-pull-requests
async function listPullRequests() {
  const url = `${BASE}/git/pullrequests?searchCriteria.status=active&api-version=7.1`;
  const res = await fetch(url, { headers: authHeader() });
  if (!res.ok) throw new Error(`ADO ${res.status}`);
  const data = await res.json();
  return data.value; // map to the shape the inbox expects
}

// GET the file changes (diff) for a PR iteration.
// .../git/repositories/{repoId}/pullRequests/{prId}/iterations/{it}/changes
async function getPullRequestChanges(repoId, prId, iteration) {
  const url = `${BASE}/git/repositories/${repoId}/pullRequests/${prId}/iterations/${iteration}/changes?api-version=7.1`;
  const res = await fetch(url, { headers: authHeader() });
  if (!res.ok) throw new Error(`ADO ${res.status}`);
  return res.json();
}

// POST a vote (approve = 10, reject = -10, wait = -5, reset = 0).
// .../git/repositories/{repoId}/pullRequests/{prId}/reviewers/{reviewerId}
async function setVote(repoId, prId, reviewerId, vote) {
  const url = `${BASE}/git/repositories/${repoId}/pullRequests/${prId}/reviewers/${reviewerId}?api-version=7.1`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ vote }),
  });
  if (!res.ok) throw new Error(`ADO ${res.status}`);
  return res.json();
}

// POST a comment thread on the PR.
async function addComment(repoId, prId, content) {
  const url = `${BASE}/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.1`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ comments: [{ content }], status: "active" }),
  });
  if (!res.ok) throw new Error(`ADO ${res.status}`);
  return res.json();
}

module.exports = { listPullRequests, getPullRequestChanges, setVote, addComment };
