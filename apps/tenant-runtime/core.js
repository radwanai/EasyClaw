// core.js — Shared bot engine for all ClawdBot agents
const { Telegraf } = require("telegraf");
const Anthropic = require("@anthropic-ai/sdk");
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const { execSync } = require("child_process");

const DATA_DIR = process.env.DATA_DIR || "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SKILLS_DIR = process.env.SKILLS_DIR || path.join(__dirname, "skills");
if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || "claude-sonnet-4-5-20250929";
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || "30", 10);
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const AUTH_CODE = process.env.AUTH_CODE;

// ─── Authorization System ─────────────────────────────
const AUTH_FILE = path.join(DATA_DIR, "authorized.json");

function loadAuthorized() {
  if (!fs.existsSync(AUTH_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")); } catch { return {}; }
}

function saveAuthorized(data) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
}

function isAuthorized(chatId) {
  if (!AUTH_CODE) return true; // No code set = open access (backwards compatible)
  const auth = loadAuthorized();
  return !!auth[String(chatId)];
}

function authorize(chatId, userName) {
  const auth = loadAuthorized();
  auth[String(chatId)] = { authorized: true, name: userName, date: new Date().toISOString() };
  saveAuthorized(auth);
}

// Set of chat IDs currently awaiting auth code input
const pendingAuth = new Set();

// ─── API Usage Logger ─────────────────────────────────

const USAGE_FILE = path.join(DATA_DIR, "usage_log.json");
const MAX_USAGE_ENTRIES = 500;

function logApiUsage(agentName, response) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      agent: agentName,
      model: response.model || MODEL,
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
      stop_reason: response.stop_reason || "unknown",
    };
    let log = [];
    if (fs.existsSync(USAGE_FILE)) {
      try { log = JSON.parse(fs.readFileSync(USAGE_FILE, "utf-8")); } catch {}
    }
    log.push(entry);
    if (log.length > MAX_USAGE_ENTRIES) log = log.slice(-MAX_USAGE_ENTRIES);
    fs.writeFileSync(USAGE_FILE, JSON.stringify(log));
  } catch {}
}

// ─── Shared Tool Implementations ──────────────────────

async function executeWebSearch(query) {
  if (!PERPLEXITY_API_KEY) return { error: "Web search not configured." };
  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        search_recency_filter: "day",
        messages: [
          { role: "system", content: `Provide the most current, real-time data. Today is ${new Date().toISOString().split("T")[0]}. Favor the most recent sources.` },
          { role: "user", content: query },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) return { error: `Perplexity error: ${data.error?.message || response.statusText}` };
    return { answer: data.choices[0].message.content, sources: (data.citations || []).slice(0, 5) };
  } catch (err) {
    return { error: `Search failed: ${err.message}` };
  }
}

function executeCode(code) {
  const logs = [];
  const sandbox = {
    console: {
      log: (...args) => logs.push(args.map(String).join(" ")),
      error: (...args) => logs.push("[ERROR] " + args.map(String).join(" ")),
    },
    Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
    Array, Object, String, Number, Boolean, RegExp, Map, Set,
  };
  try {
    const ctx = vm.createContext(sandbox);
    const result = vm.runInContext(code, ctx, { timeout: 10000 });
    return {
      result: result !== undefined ? String(result) : "(no return value)",
      logs: logs.length > 0 ? logs.join("\n") : undefined,
    };
  } catch (err) {
    return { error: err.message, logs: logs.length > 0 ? logs.join("\n") : undefined };
  }
}

function saveNote(agentName, key, content) {
  const file = path.join(DATA_DIR, `notes_${agentName}.json`);
  let notes = {};
  if (fs.existsSync(file)) {
    try { notes = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  }
  notes[key] = { content, updated: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(notes, null, 2));
  return { saved: true, key };
}

function readNotes(agentName, key) {
  const file = path.join(DATA_DIR, `notes_${agentName}.json`);
  if (!fs.existsSync(file)) return key ? { error: "No notes found" } : { keys: [] };
  let notes;
  try { notes = JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return { error: "Failed to read notes" }; }
  if (key) return notes[key] ? { key, ...notes[key] } : { error: `Note '${key}' not found` };
  return { keys: Object.keys(notes).map((k) => ({ key: k, updated: notes[k].updated })) };
}

// ─── Skill System ────────────────────────────────────

const loadedSkills = new Map();

function loadSkillFromFile(filePath) {
  const resolved = path.resolve(filePath);
  delete require.cache[resolved];
  const skill = require(resolved);
  if (!skill.name || typeof skill.name !== "string") throw new Error("Skill missing 'name' string");
  if (!skill.description || typeof skill.description !== "string") throw new Error("Skill missing 'description' string");
  if (!skill.input_schema || typeof skill.input_schema !== "object") throw new Error("Skill missing 'input_schema' object");
  if (!skill.execute || typeof skill.execute !== "function") throw new Error("Skill missing 'execute' function");
  if (!/^[a-z][a-z0-9_]*$/.test(skill.name)) throw new Error(`Skill name '${skill.name}' must be lowercase snake_case`);
  return { ...skill, filePath: resolved };
}

function loadAllSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return;
  const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".js"));
  for (const file of files) {
    try {
      const skill = loadSkillFromFile(path.join(SKILLS_DIR, file));
      loadedSkills.set(skill.name, skill);
      console.log(`  [Skills] Loaded: ${skill.name} (${file})`);
    } catch (err) {
      console.error(`  [Skills] Failed to load ${file}: ${err.message}`);
    }
  }
  console.log(`  [Skills] ${loadedSkills.size} skill(s) loaded`);
}

function validateSkillSyntax(filePath) {
  const { execSync: execSyncLocal } = require("child_process");
  try {
    execSyncLocal("node --check " + JSON.stringify(filePath), { encoding: "utf-8", timeout: 5000 });
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.stderr || err.message };
  }
}

function createSkill(name, code) {
  const filePath = path.join(SKILLS_DIR, `${name}.js`);
  if (loadedSkills.has(name)) return { error: `Skill '${name}' already exists. Use edit_skill to modify it.` };
  fs.writeFileSync(filePath, code);
  const syntaxResult = validateSkillSyntax(filePath);
  if (!syntaxResult.valid) {
    fs.unlinkSync(filePath);
    return { error: `Syntax error — skill not saved:\n${syntaxResult.error}` };
  }
  try {
    const skill = loadSkillFromFile(filePath);
    loadedSkills.set(skill.name, skill);
    console.log(`[Skills] Created: ${skill.name}`);
    return { created: true, name: skill.name, description: skill.description };
  } catch (err) {
    fs.unlinkSync(filePath);
    return { error: `Skill validation failed — not loaded:\n${err.message}` };
  }
}

function editSkill(name, code) {
  if (!loadedSkills.has(name)) return { error: `Skill '${name}' not found` };
  const skill = loadedSkills.get(name);
  const filePath = skill.filePath;
  if (!code) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return { name, content, path: filePath };
    } catch (err) {
      return { error: `Failed to read skill: ${err.message}` };
    }
  }
  const backup = fs.readFileSync(filePath, "utf-8");
  fs.writeFileSync(filePath, code);
  const syntaxResult = validateSkillSyntax(filePath);
  if (!syntaxResult.valid) {
    fs.writeFileSync(filePath, backup);
    return { error: `Syntax error — reverted to previous version:\n${syntaxResult.error}` };
  }
  try {
    const updated = loadSkillFromFile(filePath);
    loadedSkills.set(updated.name, updated);
    console.log(`[Skills] Updated: ${updated.name}`);
    return { updated: true, name: updated.name, description: updated.description };
  } catch (err) {
    fs.writeFileSync(filePath, backup);
    try { loadedSkills.set(name, loadSkillFromFile(filePath)); } catch {}
    return { error: `Validation failed — reverted:\n${err.message}` };
  }
}

function deleteSkill(name) {
  if (!loadedSkills.has(name)) return { error: `Skill '${name}' not found` };
  const skill = loadedSkills.get(name);
  try { fs.unlinkSync(skill.filePath); } catch (err) {
    return { error: `Failed to delete file: ${err.message}` };
  }
  loadedSkills.delete(name);
  console.log(`[Skills] Deleted: ${name}`);
  return { deleted: true, name };
}

function listSkills() {
  if (loadedSkills.size === 0) return { skills: "none" };
  return {
    skills: Array.from(loadedSkills.values()).map(s => ({
      name: s.name, description: s.description, file: path.basename(s.filePath),
    })),
  };
}

function getSkillToolDefs() {
  return Array.from(loadedSkills.values()).map(s => ({
    name: `skill_${s.name}`,
    description: `[Skill] ${s.description}`,
    input_schema: s.input_schema,
  }));
}

async function executeSkill(name, input) {
  const skill = loadedSkills.get(name);
  if (!skill) return { error: `Skill '${name}' not found` };
  try {
    return await skill.execute(input);
  } catch (err) {
    return { error: `Skill '${name}' failed: ${err.message}` };
  }
}

// ─── Shell & File Tools ──────────────────────────────

function executeShell(command, timeoutMs = 30000) {
  console.log(`[Shell] Executing: ${command}`);
  try {
    // Using execSync with shell intentionally — Harvey needs full shell capabilities
    // This runs inside a Docker container so blast radius is contained
    const output = execSync(command, {
      timeout: timeoutMs,
      encoding: "utf-8",
      cwd: "/app",
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      maxBuffer: 1024 * 1024,
    });
    console.log(`[Shell] Success: ${output.slice(0, 200)}`);
    return { output: output.slice(0, 4000), exit_code: 0 };
  } catch (err) {
    console.error(`[Shell] Failed: ${err.message.slice(0, 200)}`);
    return {
      error: err.stderr ? err.stderr.slice(0, 2000) : err.message.slice(0, 2000),
      output: err.stdout ? err.stdout.slice(0, 2000) : "",
      exit_code: err.status || 1,
    };
  }
}

function readFile(filePath) {
  try {
    const resolved = path.resolve("/app", filePath);
    if (!fs.existsSync(resolved)) return { error: `File not found: ${resolved}` };
    const content = fs.readFileSync(resolved, "utf-8");
    return { path: resolved, content: content.slice(0, 4000), truncated: content.length > 4000, total_chars: content.length };
  } catch (err) {
    return { error: `Read failed: ${err.message}` };
  }
}

function writeFile(filePath, content) {
  try {
    const resolved = path.resolve("/app", filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, content);
    console.log(`[File] Written: ${resolved} (${content.length} chars)`);
    return { written: true, path: resolved, size: content.length };
  } catch (err) {
    return { error: `Write failed: ${err.message}` };
  }
}

// ─── Shared Tool Definitions ──────────────────────────

const sharedTools = [
  { name: "think", description: "Internal reasoning (hidden from user).",
    input_schema: { type: "object", properties: { thought: { type: "string" } }, required: ["thought"] } },
  { name: "send_update", description: "Send progress update to user.",
    input_schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } },
  { name: "web_search", description: "Search the web for real-time info.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "run_code", description: "Run JavaScript in sandbox.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  { name: "save_note", description: "Save persistent note.",
    input_schema: { type: "object", properties: { key: { type: "string" }, content: { type: "string" } }, required: ["key", "content"] } },
  { name: "read_notes", description: "Read notes. Omit key to list all.",
    input_schema: { type: "object", properties: { key: { type: "string" } } } },
  { name: "run_shell", description: "Run shell command in Docker container at /app. 30s timeout.",
    input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "read_file", description: "Read file contents. Path relative to /app.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "write_file", description: "Write file. Path relative to /app. Read before editing.",
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
];

// ─── Bot Factory ──────────────────────────────────────

function createBot(config) {
  const { name, token, systemPrompt, tools: agentTools, executeTool: agentExecuteTool, onStart } = config;

  const bot = new Telegraf(token, { handlerTimeout: 600_000 }); // 10 min timeout for research-heavy chains
  const conversations = new Map();
  const reminders = [];
  const scheduledTasks = [];
  const botReplyCooldowns = new Map(); // Anti-loop: tracks last bot-to-bot reply per chat
  let taskIdCounter = 1;
  let currentSendUpdate = null;

  // ─── Persistent conversation history ────────────────
  const CONVO_FILE = path.join(DATA_DIR, `conversations_${name}.json`);
  let _saveTimer = null;

  function loadConversations() {
    if (!fs.existsSync(CONVO_FILE)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(CONVO_FILE, "utf-8"));
      for (const [chatId, history] of Object.entries(saved)) {
        conversations.set(parseInt(chatId), history);
      }
    } catch (e) { console.error(`  [${name}] Failed to load conversations:`, e.message); }
  }

  function saveConversations() {
    // Debounce: save at most once per 5 seconds
    if (_saveTimer) return;
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      try {
        const obj = {};
        for (const [chatId, history] of conversations) {
          // Only persist text content, skip tool_use/tool_result blocks to keep file small
          const cleaned = history.map(msg => {
            if (typeof msg.content === "string") return msg;
            if (Array.isArray(msg.content)) {
              const textOnly = msg.content.filter(b => b.type === "text");
              if (textOnly.length === 0) return null;
              return { role: msg.role, content: textOnly };
            }
            return msg;
          }).filter(Boolean);
          if (cleaned.length > 0) obj[chatId] = cleaned;
        }
        fs.writeFileSync(CONVO_FILE, JSON.stringify(obj));
      } catch (e) { console.error(`[${name}] Failed to save conversations:`, e.message); }
    }, 5000);
  }

  loadConversations();

  // Merge shared + agent-specific tools (dynamic skills added per-call)
  const allTools = [...sharedTools, ...agentTools];
  const getToolsWithSkills = () => [...allTools, ...getSkillToolDefs()];

  function getHistory(chatId) {
    if (!conversations.has(chatId)) conversations.set(chatId, []);
    return conversations.get(chatId);
  }

  function addMessage(chatId, role, content) {
    const history = getHistory(chatId);
    history.push({ role, content });
    // Trim history but preserve tool_use/tool_result pairs
    // Walk from front to find a safe cut point (user text message, not tool_result)
    if (history.length > MAX_HISTORY) {
      let cut = history.length - MAX_HISTORY;
      // Make sure we don't cut in the middle of a tool exchange
      // Move cut forward until we hit a user message with string content (not tool_result)
      while (cut < history.length - 2) {
        const msg = history[cut];
        if (msg.role === "user" && typeof msg.content === "string") break;
        cut++;
      }
      if (cut > 0) history.splice(0, cut);
    }
    saveConversations();
  }

  // Reminder system
  function setReminder(chatId, delayMinutes, message) {
    const delayMs = delayMinutes * 60 * 1000;
    const fireTime = Date.now() + delayMs;
    const timer = setTimeout(async () => {
      try { await bot.telegram.sendMessage(chatId, `⏰ Reminder: ${message}`); } catch {}
      const idx = reminders.findIndex((r) => r.timer === timer);
      if (idx >= 0) reminders.splice(idx, 1);
    }, delayMs);
    reminders.push({ chatId, time: fireTime, message, timer });
    return { scheduled: true, fires_in: `${delayMinutes} minutes` };
  }

  function listReminders(chatId) {
    const active = reminders.filter((r) => r.chatId === chatId).map((r) => ({
      message: r.message, fires_in: `${Math.round((r.time - Date.now()) / 60000)} min`,
    }));
    return active.length > 0 ? { reminders: active } : { reminders: "none" };
  }

  // Scheduled tasks
  function scheduleTaskTimer(task) {
    task.timer = setInterval(async () => {
      console.log(`[${name}] Running task ${task.id}: ${task.description}`);
      task.lastRun = new Date().toISOString();
      saveScheduledTasks();
      try {
        const result = await runAgentAutonomously(task.chatId, task.prompt);
        if (result && result.length > 0) {
          const msg = `📋 ${name}: ${task.description}\n\n${result}`;
          for (let i = 0; i < msg.length; i += 4096) {
            await bot.telegram.sendMessage(task.chatId, msg.slice(i, i + 4096));
          }
        }
      } catch (err) { console.error(`[${name}] Task ${task.id} failed:`, err.message); }
    }, task.intervalMs);
  }

  function scheduleTask(chatId, description, prompt, intervalMinutes) {
    const task = {
      id: taskIdCounter++, chatId, description, prompt,
      intervalMs: intervalMinutes * 60 * 1000, intervalMinutes, lastRun: null,
    };
    scheduleTaskTimer(task);
    scheduledTasks.push(task);
    saveScheduledTasks();
    return { scheduled: true, task_id: task.id, runs_every: `${intervalMinutes} minutes`, description };
  }

  function listScheduledTasks(chatId) {
    const tasks = scheduledTasks.filter((t) => t.chatId === chatId).map((t) => ({
      id: t.id, description: t.description, runs_every: `${t.intervalMinutes} min`, last_run: t.lastRun || "never",
    }));
    return tasks.length > 0 ? { tasks } : { tasks: "none" };
  }

  function cancelScheduledTask(taskId) {
    const idx = scheduledTasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return { error: "Task not found" };
    clearInterval(scheduledTasks[idx].timer);
    const desc = scheduledTasks[idx].description;
    scheduledTasks.splice(idx, 1);
    saveScheduledTasks();
    return { cancelled: true, description: desc };
  }

  function loadScheduledTasks() {
    const file = path.join(DATA_DIR, `tasks_${name}.json`);
    if (!fs.existsSync(file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
      for (const task of saved) {
        task.id = taskIdCounter++;
        scheduleTaskTimer(task);
        scheduledTasks.push(task);
      }
      console.log(`  [${name}] Loaded ${saved.length} scheduled tasks`);
    } catch (e) { console.error(`[${name}] Failed to load tasks:`, e.message); }
  }

  function saveScheduledTasks() {
    const file = path.join(DATA_DIR, `tasks_${name}.json`);
    const toSave = scheduledTasks.map(({ timer, ...rest }) => rest);
    fs.writeFileSync(file, JSON.stringify(toSave, null, 2));
  }

  // Tool execution dispatcher
  async function executeTool(toolName, input, chatId) {
    // Shared tools first
    switch (toolName) {
      case "think": return { thought_recorded: true };
      case "send_update":
        if (currentSendUpdate) await currentSendUpdate(input.message);
        return { sent: true };
      case "web_search": return await executeWebSearch(input.query);
      case "run_code": return executeCode(input.code);
      case "save_note": return saveNote(name, input.key, input.content);
      case "read_notes": return readNotes(name, input.key);
      case "set_reminder": return setReminder(chatId, input.delay_minutes, input.message);
      case "list_reminders": return listReminders(chatId);
      case "schedule_task": return scheduleTask(chatId, input.description, input.prompt, input.interval_minutes);
      case "list_scheduled_tasks": return listScheduledTasks(chatId);
      case "cancel_scheduled_task": return cancelScheduledTask(input.task_id);
      case "run_shell": return executeShell(input.command);
      case "read_file": return readFile(input.path);
      case "write_file": return writeFile(input.path, input.content);
    }
    // Dynamic skill dispatch
    if (toolName.startsWith("skill_")) {
      return await executeSkill(toolName.slice(6), input);
    }
    // Agent-specific tools
    if (agentExecuteTool) return await agentExecuteTool(toolName, input, chatId);
    return { error: `Unknown tool: ${toolName}` };
  }

  // Claude agent loop — userMessage can be a string or an array of content blocks (for images)
  async function askClaude(chatId, userMessage, sendUpdateFn) {
    addMessage(chatId, "user", userMessage);
    currentSendUpdate = sendUpdateFn;
    const startTime = Date.now();
    const MAX_WALL_CLOCK = 8 * 60 * 1000; // 8 min wall-clock limit (under Telegraf's 10 min)

    let response;
    for (let round = 0; round < 20; round++) {
      // Wall-clock safety: bail before Telegraf kills the process
      if (Date.now() - startTime > MAX_WALL_CLOCK) {
        console.log(`[${name}:${chatId}] Hit wall-clock limit after ${round} rounds`);
        // If we have a partial response with text, return that
        if (response) {
          const textBlocks = response.content.filter((b) => b.type === "text");
          if (textBlocks.length > 0) {
            const partial = textBlocks.map((b) => b.text).join("\n");
            addMessage(chatId, "assistant", response.content);
            currentSendUpdate = null;
            return partial + "\n\n(hit my time limit, but that's what i've got so far)";
          }
        }
        currentSendUpdate = null;
        return "took too long on that one, try asking something more specific so i don't go down a rabbit hole";
      }
      try {
        response = await anthropic.messages.create({
          model: MODEL, max_tokens: 2048,
          system: typeof systemPrompt === "function" ? systemPrompt() : systemPrompt,
          tools: getToolsWithSkills(),
          messages: getHistory(chatId),
        });
        logApiUsage(name, response);
      } catch (err) {
        const errMsg = err.message || "";
        console.error(`[${name}] Claude error:`, errMsg);

        // Rate limit — wait and retry (up to 2 retries)
        if (err.status === 429 && round < 14) {
          const waitSec = 30;
          console.log(`[${name}] Rate limited, waiting ${waitSec}s before retry...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          continue; // Retry same round
        }

        // On error, clean up history to prevent poisoned conversation
        // Remove everything from this turn to avoid orphaned tool_use/tool_result pairs
        const history = getHistory(chatId);
        // Walk backwards removing until we reach a clean state:
        // a user message with string content (not tool_result array)
        while (history.length > 0) {
          const last = history[history.length - 1];
          // A user message with plain string content = safe stopping point
          if (last.role === "user" && typeof last.content === "string") break;
          history.pop();
        }
        saveConversations();
        return "Sorry, hit an error. Try again in a moment.";
      }

      if (response.stop_reason === "tool_use") {
        addMessage(chatId, "assistant", response.content);
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === "tool_use") {
            const logInput = block.name === "think" ? "(planning...)" : JSON.stringify(block.input).slice(0, 150);
            console.log(`[${name}:${chatId}] R${round} ${block.name}: ${logInput}`);
            const result = await executeTool(block.name, block.input, chatId);
            console.log(`[${name}:${chatId}] R${round} -> ${JSON.stringify(result).slice(0, 150)}`);
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }
        addMessage(chatId, "user", toolResults);
        continue;
      }
      break;
    }

    currentSendUpdate = null;
    const textBlocks = response.content.filter((b) => b.type === "text");
    const reply = textBlocks.map((b) => b.text).join("\n") || "(no response)";
    addMessage(chatId, "assistant", response.content);
    return reply;
  }

  async function runAgentAutonomously(chatId, prompt) {
    const tempId = `auto_${chatId}_${Date.now()}`;
    const result = await askClaude(tempId, prompt, null);
    conversations.delete(tempId);
    return result;
  }

  // Shared reminder/task tool defs (added to every agent)
  const coreAgentTools = [
    { name: "set_reminder", description: "One-time reminder.", input_schema: { type: "object", properties: { delay_minutes: { type: "number" }, message: { type: "string" } }, required: ["delay_minutes", "message"] } },
    { name: "list_reminders", description: "List active reminders.", input_schema: { type: "object", properties: {} } },
    { name: "schedule_task", description: "Recurring autonomous task.", input_schema: { type: "object", properties: { description: { type: "string" }, prompt: { type: "string" }, interval_minutes: { type: "number" } }, required: ["description", "prompt", "interval_minutes"] } },
    { name: "list_scheduled_tasks", description: "List scheduled tasks.", input_schema: { type: "object", properties: {} } },
    { name: "cancel_scheduled_task", description: "Cancel task by ID.", input_schema: { type: "object", properties: { task_id: { type: "number" } }, required: ["task_id"] } },
  ];
  allTools.push(...coreAgentTools);

  // ─── Auth Middleware ────────────────────────────────
  function authGate(ctx) {
    const chatId = ctx.chat.id;
    if (isAuthorized(chatId)) return true;

    // If they're in the process of entering the code, don't show the prompt again
    if (pendingAuth.has(chatId)) return false;

    pendingAuth.add(chatId);
    console.log(`[${name}] Unauthorized access attempt from ${ctx.from.first_name} (${chatId})`);
    ctx.reply("This bot is private. Please enter the authorization code:");
    return false;
  }

  // Telegram handlers
  bot.command("start", (ctx) => {
    if (!isAuthorized(ctx.chat.id)) {
      pendingAuth.add(ctx.chat.id);
      ctx.reply(`Hi! I'm ${name}. This bot is private.\n\nPlease enter the authorization code to continue:`);
      return;
    }
    if (onStart) return onStart(ctx);
    ctx.reply(`Hi! I'm ${name}. How can I help?`);
  });

  bot.command("reset", (ctx) => {
    if (!authGate(ctx)) return;
    conversations.delete(ctx.chat.id);
    saveConversations();
    ctx.reply("Conversation cleared.");
  });

  bot.command("tasks", (ctx) => {
    if (!authGate(ctx)) return;
    const tasks = scheduledTasks.filter((t) => t.chatId === ctx.chat.id);
    if (tasks.length === 0) return ctx.reply("No scheduled tasks.");
    const list = tasks.map((t) => `#${t.id}: ${t.description} (every ${t.intervalMinutes}min)`).join("\n");
    ctx.reply(`📋 Scheduled tasks:\n\n${list}`);
  });

  // /voice command — Harvey responds with Egyptian Arabic voice note
  bot.command("voice", async (ctx) => {
    if (!authGate(ctx)) return;
    if (name !== "Harvey") return; // Only Harvey has voice
    const args = ctx.message.text.replace("/voice", "").trim();
    if (!args) {
      await ctx.reply("🎙️ What should I say? Example:\n\n_/voice tell me about today's news_", { parse_mode: "Markdown" });
      return;
    }

    const chatId = ctx.chat.id;
    await ctx.sendChatAction("record_voice");

    // Get Claude's response first (in Arabic)
    const voicePrompt = `The user asked you something. Respond naturally IN EGYPTIAN ARABIC (عامية مصرية). Keep it conversational, warm, and concise — this will be spoken out loud as a voice message. 2-4 sentences max. Don't use emoji or formatting.

User said: ${args}`;

    try {
      const tempId = `voice_${chatId}_${Date.now()}`;
      const claudeReply = await askClaude(tempId, voicePrompt, null);
      conversations.delete(tempId);

      // Convert to voice
      const { textToVoice } = require("./voice");
      await ctx.sendChatAction("record_voice");
      const audio = await textToVoice(claudeReply);

      // Send as voice note or audio file
      const fs = require("fs");
      if (audio.format === "ogg") {
        await ctx.replyWithVoice({ source: fs.createReadStream(audio.path) });
      } else {
        await ctx.replyWithAudio({ source: fs.createReadStream(audio.path) });
      }

      // Clean up
      try { fs.unlinkSync(audio.path); } catch {}
      console.log(`[${name}:${chatId}] Voice sent: "${claudeReply.slice(0, 60)}..."`);
    } catch (err) {
      console.error(`[${name}] Voice error:`, err.message);
      await ctx.reply("Voice failed — " + err.message);
    }
  });

  // /meetup command — agent-to-agent conversation
  // Only Harvey handles meetups to avoid double-trigger in groups
  bot.command("meetup", async (ctx) => {
    if (!authGate(ctx)) return;
    if (name !== "Harvey") return; // Only Harvey runs meetups
    const args = ctx.message.text.replace("/meetup", "").trim();
    const chatId = ctx.chat.id;

    // Require a topic — ask for one if not provided
    if (args.length === 0) {
      await ctx.reply("☕ What should we talk about? Send the topic:\n\n_Example: /meetup AI replacing white collar jobs_", { parse_mode: "Markdown" });
      return;
    }

    const topic = args;

    // Get both bot Telegram instances from the registry
    const { botRegistry } = require("./index");
    const harveyRef = botRegistry["Harvey"];
    const lauraRef = botRegistry["Laura"];
    if (!harveyRef || !lauraRef) {
      await ctx.reply("Meetup requires both Harvey and Laura to be online.");
      return;
    }

    // Run in background — each bot sends their own messages in real-time
    const { runMeetup } = require("./meetup");
    runMeetup({
      chatId,
      bots: {
        Harvey: harveyRef.bot.telegram,
        Laura: lauraRef.bot.telegram,
      },
      topic,
    }).catch(async (err) => {
      console.error("[Meetup] Failed:", err.message);
      try { await bot.telegram.sendMessage(chatId, "Meetup failed — check logs."); } catch {}
    });
  });

  // Store bot username for group chat @mention detection
  let botUsername = "";

  // Voice message handler — transcribe and respond
  bot.on("voice", async (ctx) => {
    const chatId = ctx.chat.id;
    const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";

    if (!isAuthorized(chatId)) return; // Ignore voice from unauthorized chats

    // In groups, only Harvey handles voice to avoid double processing
    if (isGroup && name !== "Harvey") return;

    try {
      await ctx.sendChatAction("typing");

      // Download the voice file from Telegram
      const fileId = ctx.message.voice.file_id;
      const fileLink = await bot.telegram.getFileLink(fileId);
      const voiceResponse = await fetch(fileLink.href);
      const voiceBuffer = Buffer.from(await voiceResponse.arrayBuffer());

      // Save temporarily
      const voicePath = path.join(DATA_DIR, "voice", `recv_${Date.now()}.ogg`);
      const voiceDir = path.dirname(voicePath);
      if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
      fs.writeFileSync(voicePath, voiceBuffer);

      // Transcribe
      const { transcribeVoice } = require("./voice");
      const transcript = await transcribeVoice(voicePath);

      // Clean up
      try { fs.unlinkSync(voicePath); } catch {}

      if (!transcript || transcript.trim().length === 0) {
        await ctx.reply("Couldn't catch that — try again?");
        return;
      }

      console.log(`[${name}:${chatId}] Voice transcribed: "${transcript.slice(0, 80)}"`);

      // During meetups, push to meetup conversation
      const { isMeetupActive, pushUserMessage } = require("./meetup");
      if (isMeetupActive(chatId)) {
        pushUserMessage(chatId, ctx.from.first_name || "User", transcript);
        return;
      }

      // Feed transcript to Claude as if the user typed it
      const userMsg = isGroup
        ? `[${ctx.from.first_name || "User"} in group "${ctx.chat.title}" via voice message]: ${transcript}`
        : `[voice message]: ${transcript}`;

      const sendUpdateFn = async (msg) => { try { await ctx.reply(`⏳ ${msg}`); } catch {} };
      const reply = await askClaude(chatId, userMsg, sendUpdateFn);
      for (let i = 0; i < reply.length; i += 4096) {
        await ctx.reply(reply.slice(i, i + 4096));
      }
      console.log(`[${name}:${chatId}] Voice reply done`);
    } catch (err) {
      console.error(`[${name}] Voice handler error:`, err.message);
      await ctx.reply("Couldn't process that voice message — " + err.message);
    }
  });

  // Photo/image handler — download, base64 encode, send to Claude vision
  bot.on("photo", async (ctx) => {
    const chatId = ctx.chat.id;
    const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";

    if (!isAuthorized(chatId)) return;

    // In groups, only respond if mentioned in the caption
    if (isGroup) {
      const caption = (ctx.message.caption || "").toLowerCase();
      const mentionTag = botUsername ? `@${botUsername}` : null;
      const mentioned = (mentionTag && caption.includes(mentionTag.toLowerCase())) ||
                        caption.includes(name.toLowerCase());
      if (!mentioned) {
        // Passive observation: note that a photo was sent
        const speaker = ctx.message.from.is_bot ? (ctx.message.from.first_name || "Bot") : (ctx.from.first_name || "User");
        addMessage(chatId, "user", `[${speaker} in group "${ctx.chat.title}" sent a photo${ctx.message.caption ? ": " + ctx.message.caption : ""}]`);
        return;
      }
    }

    try {
      await ctx.sendChatAction("typing");

      // Get the largest photo (last in the array)
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const fileLink = await bot.telegram.getFileLink(largest.file_id);

      // Download and base64 encode
      const response = await fetch(fileLink.href);
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString("base64");

      // Determine media type from URL
      const url = fileLink.href;
      const mediaType = url.includes(".png") ? "image/png" :
                        url.includes(".gif") ? "image/gif" :
                        url.includes(".webp") ? "image/webp" : "image/jpeg";

      // Build content blocks: image + optional caption text
      let caption = ctx.message.caption || "";
      if (isGroup) {
        // Strip mention from caption
        const mentionTag = botUsername ? `@${botUsername}` : null;
        if (mentionTag) caption = caption.replace(new RegExp(mentionTag, "gi"), "").trim();
        caption = caption.replace(new RegExp(`^${name}[,:]?\\s*`, "i"), "").trim();
      }

      const contextPrefix = isGroup
        ? `[${ctx.from.first_name || "User"} in group "${ctx.chat.title}" sent a photo]: `
        : "[photo]: ";

      const contentBlocks = [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: contextPrefix + (caption || "What's this?") },
      ];

      console.log(`[${name}:${chatId}] Photo received (${Math.round(buffer.length / 1024)}KB)${caption ? ": " + caption : ""}`);
      const sendUpdateFn = async (msg) => { try { await ctx.reply(`⏳ ${msg}`); } catch {} };
      const reply = await askClaude(chatId, contentBlocks, sendUpdateFn);
      for (let i = 0; i < reply.length; i += 4096) {
        await ctx.reply(reply.slice(i, i + 4096));
      }
      console.log(`[${name}:${chatId}] Photo reply done`);
    } catch (err) {
      console.error(`[${name}] Photo handler error:`, err.message);
      await ctx.reply("couldn't process that image — " + err.message);
    }
  });

  bot.on("text", async (ctx) => {
    const chatId = ctx.chat.id;
    let text = ctx.message.text;
    const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";

    // During an active meetup, capture user messages for the conversation
    // Only Harvey captures to avoid duplicates from both bots
    // No mention filter — any message goes into the meetup
    const { isMeetupActive, pushUserMessage } = require("./meetup");
    if (name === "Harvey" && isMeetupActive(chatId) && !ctx.message.from.is_bot) {
      pushUserMessage(chatId, ctx.from.first_name || "User", text);
      return;
    }
    // Laura ignores all messages during meetups
    if (name !== "Harvey" && isMeetupActive(chatId)) return;

    // In group chats: only respond if mentioned by @username or name
    // For bot messages: respond once then cooldown to prevent infinite loops
    // BUT: allow auth code through when group is pending authorization
    if (isGroup && isAuthorized(chatId)) {
      const fromBot = ctx.message.from.is_bot;
      const mentionTag = botUsername ? `@${botUsername}` : null;
      const mentioned = (mentionTag && text.toLowerCase().includes(mentionTag.toLowerCase())) ||
                        text.toLowerCase().includes(name.toLowerCase());

      if (!mentioned) {
        // Passive observation: silently add to history so bot has group context
        // when it IS mentioned later. No response sent.
        const speaker = fromBot ? (ctx.message.from.first_name || "Bot") : (ctx.from.first_name || "User");
        addMessage(chatId, "user", `[${speaker} in group "${ctx.chat.title}"]: ${text}`);
        return;
      }

      // Anti-loop: if message is from another bot, only respond if we haven't
      // replied to a bot in this chat in the last 60 seconds
      if (fromBot) {
        const cooldownKey = `botreply_${chatId}`;
        const lastReply = botReplyCooldowns.get(cooldownKey) || 0;
        if (Date.now() - lastReply < 60000) return; // Still in cooldown, ignore
        botReplyCooldowns.set(cooldownKey, Date.now());
      }

      // Strip the @mention from the message so Claude gets clean text
      if (mentionTag) text = text.replace(new RegExp(mentionTag, "gi"), "").trim();
      text = text.replace(new RegExp(`^${name}[,:]?\\s*`, "i"), "").trim();
      if (!text) return;
    }

    // Handle auth code entry (skip auth for group chats — auth the group on first mention)
    if (!isAuthorized(chatId)) {
      if (isGroup) {
        // In groups, authorize automatically if the user sending is already authorized in DM
        // Or accept the auth code in the group
        if (AUTH_CODE && text.trim() === AUTH_CODE) {
          authorize(chatId, `Group: ${ctx.chat.title || chatId}`);
          pendingAuth.delete(chatId);
          console.log(`[${name}] Authorized group: ${ctx.chat.title} (${chatId})`);
          return ctx.reply(`Group authorized! I'm ${name}. Mention me by name or @${botUsername} to chat.`);
        }
        if (!pendingAuth.has(chatId)) {
          pendingAuth.add(chatId);
          return ctx.reply(`Hi! I'm ${name}. This group needs to be authorized. Please send the auth code:`);
        }
        return ctx.reply("Incorrect code. Try again:");
      }

      if (AUTH_CODE && text.trim() === AUTH_CODE) {
        authorize(chatId, ctx.from.first_name || ctx.from.username || "Unknown");
        pendingAuth.delete(chatId);
        console.log(`[${name}] Authorized: ${ctx.from.first_name} (${chatId})`);
        if (onStart) return onStart(ctx);
        return ctx.reply(`Access granted! Welcome. I'm ${name}.`);
      }
      if (pendingAuth.has(chatId)) {
        console.log(`[${name}] Wrong auth code from ${ctx.from.first_name} (${chatId})`);
        return ctx.reply("Incorrect code. Try again:");
      }
      pendingAuth.add(chatId);
      return ctx.reply("This bot is private. Please enter the authorization code:");
    }

    // Add sender context for group chats so Claude knows who's talking
    const userMsg = isGroup
      ? `[${ctx.from.first_name || "User"} in group "${ctx.chat.title}"]: ${text}`
      : text;

    console.log(`[${name}:${chatId}] ${ctx.from.first_name}: ${text}`);
    const sendUpdateFn = async (msg) => { try { await ctx.reply(`⏳ ${msg}`); } catch {} };
    await ctx.sendChatAction("typing");
    const reply = await askClaude(chatId, userMsg, sendUpdateFn);
    for (let i = 0; i < reply.length; i += 4096) {
      await ctx.reply(reply.slice(i, i + 4096));
    }
    console.log(`[${name}:${chatId}] Done`);
  });

  // Launch
  async function launch() {
    loadScheduledTasks();
    const botInfo = await bot.telegram.getMe();
    botUsername = botInfo.username;
    console.log(`  [${name}] Telegram: @${botInfo.username}`);
    bot.launch({ dropPendingUpdates: true });
    console.log(`  [${name}] Live!`);
  }

  return { bot, launch, askClaude, runAgentAutonomously, addMessage };
}

module.exports = { createBot, executeWebSearch, executeCode, executeShell, readFile, writeFile, saveNote, readNotes, DATA_DIR, isAuthorized, loadAllSkills, createSkill, editSkill, deleteSkill, listSkills, getSkillToolDefs, executeSkill, loadedSkills };
