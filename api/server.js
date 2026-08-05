// PR Copilot for Leads — backend (Node.js, zero dependencies).
// ---------------------------------------------------------------------------
// Created by Vinod Kumar K J (AIBS) <vjanardhana@microsoft.com>
// © 2026 Vinod Kumar K J. All rights reserved. Microsoft Global Hackathon 2026.
// ---------------------------------------------------------------------------
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
const { VERSION, AUTHOR, AUTHOR_EMAIL, AUTHOR_ORG } = require("./version");

const PORT = process.env.PORT || 3000;
const APP_DIR = path.join(__dirname, "..", "app");

// ---- tiny helpers ----
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

  // Per-user context: the signed-in user's ADO token (Bearer) + chosen org.
  // When present, every ADO call is made AS THAT USER (multi-user, multi-project).
  const authz = req.headers["authorization"] || "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const ctx = { token: bearer || null, org: parsed.searchParams.get("org") || null };

  try {
    // Config: current org/project defaults + mode
    if (url === "/api/config" && method === "GET") {
      return sendJson(res, 200, { ...svc.defaults(ctx), version: VERSION });
    }
    // App version (for update-available checks)
    if (url === "/api/version" && method === "GET") {
      return sendJson(res, 200, { version: VERSION, author: AUTHOR, email: AUTHOR_EMAIL, org: AUTHOR_ORG });
    }
    // List organizations the signed-in user belongs to
    if (url === "/api/orgs" && method === "GET") {
      return sendJson(res, 200, await svc.getOrgs(ctx));
    }
    // List projects in the org
    if (url === "/api/projects" && method === "GET") {
      return sendJson(res, 200, await svc.getProjects(ctx));
    }
    // List repos in a project
    if (url === "/api/repos" && method === "GET") {
      const project = parsed.searchParams.get("project") || undefined;
      return sendJson(res, 200, await svc.getRepos(ctx, project));
    }

    // Triage "Today" queue — ranked across active PRs.
    if (url === "/api/today" && method === "GET") {
      const project = parsed.searchParams.get("project") || undefined;
      const repo = parsed.searchParams.get("repo") || undefined;
      const list = await svc.getList(ctx, "active", project, repo);
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
        const list = await svc.getList(ctx, status, project, repo);
        return sendJson(res, 200, list);
      }

      const project = parsed.searchParams.get("project") || undefined;
      const pr = await svc.getDetail(ctx, id, project);
      if (!pr) return sendJson(res, 404, { error: "PR not found" });

      if (!action && method === "GET") return sendJson(res, 200, pr);
      if (action === "summary" && method === "GET")
        return sendJson(res, 200, { summary: pr.summary, risk: pr.risk, reasons: pr.reasons });
      if (action === "comment-draft" && method === "GET")
        return sendJson(res, 200, { text: svc.commentDraftFor(pr) });

      if (method === "POST") {
        const body = await readBody(req);
        // Write actions run AS THE USER in proxy mode (ADO enforces permissions);
        // in dev-cred/mock they return a safe read-only preview.
        if (action === "approve")
          return sendJson(res, 200, await svc.voteOnPr(ctx, id, project, 10));
        if (action === "reject")
          return sendJson(res, 200, await svc.voteOnPr(ctx, id, project, -10));
        if (action === "comment")
          return sendJson(res, 200, await svc.commentOnPr(ctx, id, project, body.text));
        if (action === "revert")
          return sendJson(res, 200, await svc.revertPr(ctx, id, project, body.ontoRef));
        if (action === "cherry-pick")
          return sendJson(res, 200, await svc.cherryPickPr(ctx, id, project, body.ontoRef));
      }
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    // health
    if (url === "/api/health")
      return sendJson(res, 200, { ok: true, mode: ctx.token ? "user" : svc.MODE });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }

  // static PWA
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  PR Copilot for Leads running  [mode: ${svc.MODE}]  v${VERSION}`);
  console.log(`  Created by ${AUTHOR} (${AUTHOR_ORG}) <${AUTHOR_EMAIL}>`);
  console.log(`  → Local:   http://localhost:${PORT}`);
  console.log(`  → Phone:   http://<your-laptop-ip>:${PORT}  (same Wi-Fi)\n`);
});
