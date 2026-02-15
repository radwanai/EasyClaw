// dashboard-server.js — Lightweight local server for ClawdBot dashboard
// Run: node dashboard-server.js
// Opens: http://localhost:3456

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3456;
const DATA_DIR = path.join(__dirname, "data");
const HTML_FILE = path.join(__dirname, "dashboard.html");

const DATA_FILES = {
  memories: "harvey_memory.json",
  tasks: "laura_tasks.json",
  emails: "email_cache.json",
  calendar: "calendar_cache.json",
  twitter: "twitter_cache.json",
  authorized: "authorized.json",
  usage: "usage_log.json",
  harvey_notes: "notes_Harvey.json",
  laura_notes: "notes_Laura.json",
  harvey_tasks: "tasks_Harvey.json",
  laura_scheduled: "tasks_Laura.json",
};

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function getFileStats(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    return { size: stat.size, modified: stat.mtime.toISOString() };
  } catch {
    return null;
  }
}

function getAllData() {
  const result = {};
  for (const [key, filename] of Object.entries(DATA_FILES)) {
    const filePath = path.join(DATA_DIR, filename);
    result[key] = readJsonFile(filePath);
  }
  // Add file stats
  result._stats = {};
  for (const [key, filename] of Object.entries(DATA_FILES)) {
    const filePath = path.join(DATA_DIR, filename);
    result._stats[key] = getFileStats(filePath);
  }
  result._stats.serverTime = new Date().toISOString();
  return result;
}

// Parse POST body (Twilio sends application/x-www-form-urlencoded)
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const params = new URLSearchParams(body);
        resolve(Object.fromEntries(params));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/api/data") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getAllData()));
    return;
  }

  if (req.url === "/" || req.url === "/dashboard.html") {
    try {
      const html = fs.readFileSync(HTML_FILE, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end("Dashboard HTML not found. Make sure dashboard.html exists.");
    }
    return;
  }

  // Gmail OAuth callback
  if (req.url.startsWith("/oauth/callback")) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h2>Missing authorization code</h2><p>Try the auth link again.</p>");
        return;
      }
      const { handleAuthCallback } = require("./gmail");
      await handleAuthCallback(code);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family:system-ui;text-align:center;padding:60px">
          <h1>✅ Gmail Connected!</h1>
          <p style="font-size:1.2em;color:#555">Harvey now has access to your Gmail.</p>
          <p>You can close this tab and go back to Telegram.</p>
        </body></html>
      `);
      console.log("[Gmail] OAuth callback success — token saved");
    } catch (err) {
      console.error("[Gmail] OAuth callback error:", err.message);
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h2>Authorization failed</h2><p>${err.message}</p><p>Try the auth link again.</p>`);
    }
    return;
  }

  // Twilio webhook routes (handled by phone.js if registered)
  if (req.method === "POST" && req.url.startsWith("/twilio/")) {
    const body = await parseBody(req);
    if (server._twilioHandler) {
      return server._twilioHandler(req, res, body);
    }
    res.writeHead(404);
    res.end("Phone system not initialized");
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n  ClawdBot Dashboard`);
  console.log(`  http://localhost:${PORT}\n`);
});

module.exports = server;
