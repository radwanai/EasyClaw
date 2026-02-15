// index.js — ClawdBot Multi-Agent Launcher
require("dotenv").config();

if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY missing"); process.exit(1); }

const harvey = require("./harvey");
const laura = require("./laura");

// ─── Shared Bot Registry ─────────────────────────────
// Allows bots to find each other (used by meetup for real-time chat)
const botRegistry = {};
module.exports = { botRegistry };

console.log("═══════════════════════════════════════");
console.log("  ClawdBot Multi-Agent System");
console.log("═══════════════════════════════════════");
console.log(`  Model: ${process.env.MODEL || "claude-sonnet-4-5-20250929"}`);
console.log(`  Web search: ${process.env.PERPLEXITY_API_KEY ? "enabled" : "disabled"}`);
console.log("");

async function main() {
  const agents = [];

  // Load skills from skills/ directory
  const { loadAllSkills } = require("./core");
  loadAllSkills();

  // Harvey — Personal Assistant
  try {
    const h = harvey.create();
    if (h) {
      await h.launch();
      botRegistry["Harvey"] = h;
      agents.push("Harvey");
    }
  } catch (err) {
    console.error("[Harvey] Failed to start:", err.message);
  }

  // Laura — SHR Company Agent
  try {
    const l = laura.create();
    if (l) {
      await l.launch();
      botRegistry["Laura"] = l;
      agents.push("Laura");
    }
  } catch (err) {
    console.error("[Laura] Failed to start:", err.message);
  }

  if (agents.length === 0) {
    console.error("No agents started! Check your .env tokens.");
    process.exit(1);
  }

  // Start Harvey's proactive life engine
  if (botRegistry["Harvey"]) {
    const { startHarveyLife } = require("./harvey-life");
    startHarveyLife(botRegistry["Harvey"]);
  }

  // Start dashboard server
  let server;
  try {
    server = require("./dashboard-server");
    console.log("  Dashboard: http://localhost:3456");
  } catch (err) {
    console.error("[Dashboard] Failed to start:", err.message);
  }

  // Start phone system (attaches to dashboard HTTP server)
  if (server) {
    try {
      const { startPhoneServer } = require("./phone");
      await startPhoneServer(server);
    } catch (err) {
      console.error("[Phone] Failed to start:", err.message);
    }
  }

  console.log("");
  console.log(`═══ ${agents.length} agent(s) live: ${agents.join(", ")} ═══`);
  console.log(`  /meetup command: enabled`);
  console.log(`  /voice command: enabled`);
  console.log(`  Phone calls: ${process.env.TWILIO_ACCOUNT_SID ? "enabled" : "disabled"}`);
  console.log(`  Harvey Life: active`);
  try {
    const { isAuthenticated } = require("./gmail");
    console.log(`  Gmail: ${isAuthenticated() ? "connected" : "not connected (use gmail_auth)"}`);
  } catch { console.log("  Gmail: module not loaded"); }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});

process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
