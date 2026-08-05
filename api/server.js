// PR Copilot for Leads — backend (Node.js, zero dependencies).
// Serves the PWA (../app) AND a small JSON API.
//
// Data source is chosen by env ADO_MODE:
//   mock (default) → api/mock-data.js, works offline, no Azure
//   live           → api/liveAdo.js, read-only, uses your cached Git credential
//
// Run:   npm start            (mock)
//        npm run start:live   (live Azure DevOps)
// Then:  open http://localhost:3000 on your laptop,
//        or http://<your-laptop-ip>:3000 on your phone (same Wi-Fi).

const http = require("http");
const fs = require("fs");
const path = require("path");
const svc = require("./prService");

const PORT = process.env.PORT || 3000;
const APP_DIR = path.join(__dirname, "..", "app");

// ---- tiny helpers ----
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(APP_DIR, urlPath);
  // Prevent path traversal
  if (!filePath.startsWith(APP_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

// ---- router ----
const server = http.createServer(async (req, res) => {
  const { method } = req;
  const parsed = new URL(req.url, "http://localhost");
  const url = parsed.pathname;

  if (method === "OPTIONS") return sendJson(res, 204, {});

  try {
    // Config: current org/project defaults + mode
    if (url === "/api/config" && method === "GET") {
      return sendJson(res, 200, svc.defaults());
    }
    // List projects in the org
    if (url === "/api/projects" && method === "GET") {
      return sendJson(res, 200, await svc.getProjects());
    }
    // List repos in a project
    if (url === "/api/repos" && method === "GET") {
      const project = parsed.searchParams.get("project") || undefined;
      return sendJson(res, 200, await svc.getRepos(project));
    }

    // Triage "Today" queue — ranked across active PRs.
    if (url === "/api/today" && method === "GET") {
      const project = parsed.searchParams.get("project") || undefined;
      const repo = parsed.searchParams.get("repo") || undefined;
      const list = await svc.getList("active", project, repo);
      const ranked = list
        .slice()
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .slice(0, 10);
      return sendJson(res, 200, ranked);
    }

    // API routes: /api/prs , /api/prs/:id , /api/prs/:id/:action
    const m = url.match(/^\/api\/prs(?:\/(\d+))?(?:\/([\w-]+))?$/);
    if (m) {
      const id = m[1];
      const action = m[2];

      if (!id && method === "GET") {
        const status = parsed.searchParams.get("status") || "active";
        const project = parsed.searchParams.get("project") || undefined;
        const repo = parsed.searchParams.get("repo") || undefined;
        const list = await svc.getList(status, project, repo);
        return sendJson(res, 200, list);
      }

      const project = parsed.searchParams.get("project") || undefined;
      const pr = await svc.getDetail(id, project);
      if (!pr) return sendJson(res, 404, { error: "PR not found" });

      if (!action && method === "GET") return sendJson(res, 200, pr);
      if (action === "summary" && method === "GET")
        return sendJson(res, 200, { summary: pr.summary, risk: pr.risk, reasons: pr.reasons });
      if (action === "comment-draft" && method === "GET")
        return sendJson(res, 200, { text: svc.commentDraftFor(pr) });

      if (method === "POST") {
        const body = await readBody(req);
        // Actions are acknowledged; live WRITE is intentionally not enabled yet
        // (read-only phase). Wiring: liveAdo.setVote / addComment.
        if (action === "approve")
          return sendJson(res, 200, { ok: true, action: "approved", id: pr.id, note: svc.MODE === "live" ? "read-only: not sent to ADO" : "mock" });
        if (action === "reject")
          return sendJson(res, 200, { ok: true, action: "rejected", id: pr.id, note: svc.MODE === "live" ? "read-only: not sent to ADO" : "mock" });
        if (action === "comment")
          return sendJson(res, 200, { ok: true, action: "commented", id: pr.id, text: body.text, note: svc.MODE === "live" ? "read-only: not sent to ADO" : "mock" });
      }
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    // health
    if (url === "/api/health")
      return sendJson(res, 200, { ok: true, mode: svc.MODE });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }

  // static PWA
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  PR Copilot for Leads running  [mode: ${svc.MODE}]`);
  console.log(`  → Local:   http://localhost:${PORT}`);
  console.log(`  → Phone:   http://<your-laptop-ip>:${PORT}  (same Wi-Fi)\n`);
});
