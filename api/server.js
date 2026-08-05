// PR Copilot for Leads — mock backend (Node.js, zero dependencies).
// Serves the PWA (../app) AND a small JSON API backed by mock data.
//
// Run:   npm start        (from the api/ folder, or `node server.js`)
// Then:  open http://localhost:3000 on your laptop,
//        or http://<your-laptop-ip>:3000 on your phone (same Wi-Fi).
//
// Swapping in real data later:
//   - Replace the getPRs()/getPR() bodies with api/adoClient.js (Azure DevOps REST).
//   - Replace the canned summary/commentDraft with api/aiClient.js (Azure OpenAI).

const http = require("http");
const fs = require("fs");
const path = require("path");
const { PRS } = require("./mock-data");

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

// ---- mock "service" layer (swap for real ADO + AI later) ----
function listPRs() {
  // Only the fields the inbox needs.
  return PRS.map((p) => ({
    id: p.id,
    title: p.title,
    author: p.author,
    risk: p.risk,
    summaryShort: p.summaryShort,
    checks: p.checks,
  }));
}
function getPR(id) {
  return PRS.find((p) => p.id === Number(id));
}

// ---- router ----
const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === "OPTIONS") return sendJson(res, 204, {});

  // API routes
  const m = url.match(/^\/api\/prs(?:\/(\d+))?(?:\/(\w[\w-]*))?/);
  if (m) {
    const id = m[1];
    const action = m[2];

    if (!id && method === "GET") return sendJson(res, 200, listPRs());

    const pr = getPR(id);
    if (!pr) return sendJson(res, 404, { error: "PR not found" });

    if (!action && method === "GET") return sendJson(res, 200, pr);
    if (action === "summary" && method === "GET")
      return sendJson(res, 200, { summary: pr.summary, risk: pr.risk });
    if (action === "comment-draft" && method === "GET")
      return sendJson(res, 200, { text: pr.commentDraft });

    if (method === "POST") {
      const body = await readBody(req);
      // In the mock we just acknowledge; real impl calls ADO REST.
      if (action === "approve") return sendJson(res, 200, { ok: true, action: "approved", id: pr.id });
      if (action === "reject") return sendJson(res, 200, { ok: true, action: "rejected", id: pr.id });
      if (action === "comment")
        return sendJson(res, 200, { ok: true, action: "commented", id: pr.id, text: body.text });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  // health
  if (url === "/api/health") return sendJson(res, 200, { ok: true, mode: "mock" });

  // static PWA
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  PR Copilot for Leads (mock) running`);
  console.log(`  → Local:   http://localhost:${PORT}`);
  console.log(`  → Phone:   http://<your-laptop-ip>:${PORT}  (same Wi-Fi)\n`);
});
