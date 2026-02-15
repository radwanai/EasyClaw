// laura.js — Laura: SHR Company Email & Task Agent
const { createBot, DATA_DIR } = require("./core");
const fs = require("fs");
const path = require("path");

// ─── Cache-Based Email/Calendar Access ────────────────
// Data synced from MCP Outlook connection via Claude Code

function readEmailCache() {
  const file = path.join(DATA_DIR, "email_cache.json");
  if (!fs.existsSync(file)) return { error: "No email data available. Ask Sameh to sync emails from Claude Code." };
  try {
    const cache = JSON.parse(fs.readFileSync(file, "utf-8"));
    return cache;
  } catch { return { error: "Failed to read email cache." }; }
}

function readCalendarCache() {
  const file = path.join(DATA_DIR, "calendar_cache.json");
  if (!fs.existsSync(file)) return { error: "No calendar data available. Ask Sameh to sync calendar from Claude Code." };
  try {
    const cache = JSON.parse(fs.readFileSync(file, "utf-8"));
    return cache;
  } catch { return { error: "Failed to read calendar cache." }; }
}

// ─── Task Management ──────────────────────────────────

function getTasksFile() { return path.join(DATA_DIR, "laura_tasks.json"); }

function loadTasks() {
  const file = getTasksFile();
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return []; }
}

function saveTasks(tasks) {
  fs.writeFileSync(getTasksFile(), JSON.stringify(tasks, null, 2));
}

// ─── Draft Storage ────────────────────────────────────

function getDraftsFile() { return path.join(DATA_DIR, "laura_drafts.json"); }

function loadDrafts() {
  const file = getDraftsFile();
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return []; }
}

function saveDrafts(drafts) {
  fs.writeFileSync(getDraftsFile(), JSON.stringify(drafts, null, 2));
}

// ─── Laura-Specific Tools ─────────────────────────────

const lauraTools = [
  {
    name: "read_emails",
    description: "Read recent emails from Outlook (synced cache). Returns subject, sender, preview, date. Use query to filter by keyword, sender, or subject. NEVER sends emails — read-only.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional keyword to filter emails by subject, sender, or preview text." },
        count: { type: "number", description: "Number of emails to return (default: 10)" },
        unread_only: { type: "boolean", description: "Only show unread emails (default: false)" },
      },
    },
  },
  {
    name: "draft_response",
    description: "Draft an email response and save it for Sameh's review. NEVER sends the email — only saves a draft that Sameh can review and send manually.",
    input_schema: {
      type: "object",
      properties: {
        original_subject: { type: "string", description: "Subject of original email" },
        original_from: { type: "string", description: "Sender of original email" },
        draft_body: { type: "string", description: "Your drafted response text" },
        priority: { type: "string", description: "urgent, normal, or low" },
      },
      required: ["original_subject", "original_from", "draft_body"],
    },
  },
  {
    name: "list_drafts",
    description: "List all saved email draft responses waiting for Sameh's review.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_task",
    description: "Create a task for Sameh's daily task list. Tasks can come from emails, meetings, or direct requests.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task details" },
        priority: { type: "string", description: "high, medium, or low" },
        source: { type: "string", description: "Where this task came from (e.g., 'Email from John', 'Meeting follow-up')" },
        due: { type: "string", description: "Due date or time description (e.g., 'today', 'tomorrow', 'Friday')" },
      },
      required: ["title", "priority"],
    },
  },
  {
    name: "list_tasks",
    description: "List all current tasks. Can filter by status or priority.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter: 'pending', 'done', or 'all' (default: pending)" },
      },
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as completed by its ID.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "Task ID to complete" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "read_calendar",
    description: "Read upcoming calendar events from Outlook (synced cache).",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Filter by date (e.g., 'today', '2026-02-13'). Default: show all cached events." },
      },
    },
  },
  {
    name: "remember",
    description: "Save info about Sameh, SHR Company, or work context to memory. Use proactively when you learn something useful.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["work", "contacts", "company", "preferences", "general"] },
        text: { type: "string", description: "What to remember" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["category", "text"],
    },
  },
  {
    name: "recall",
    description: "Search your memories about Sameh, SHR, contacts, or work context.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "check_x",
    description: "Search X/Twitter for industry news, competitor activity, or trends. trending=whats hot, search=topic.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["trending", "search"] },
        query: { type: "string", description: "Search query (type=search)" },
      },
      required: ["type"],
    },
  },
  {
    name: "send_to_group",
    description: "Send a message to the group chat with Sameh & Harvey. Use when Sameh asks you to say something in the group.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to send in the group chat" },
      },
      required: ["message"],
    },
  },
];

// ─── Laura Tool Execution ─────────────────────────────

async function executeTool(toolName, input, chatId) {
  switch (toolName) {
    case "read_emails": return readEmails(input.query, input.count, input.unread_only);
    case "draft_response": return draftResponse(input);
    case "list_drafts": return { drafts: loadDrafts().slice(-20) };
    case "create_task": return createTask(input);
    case "list_tasks": return listTasks(input.status);
    case "complete_task": return completeTask(input.task_id);
    case "read_calendar": return readCalendar(input.date);
    case "remember": {
      try {
        const { addMemory } = require("./memory");
        return addMemory(input.category, input.text, input.tags || []);
      } catch (err) {
        return { error: `memory save failed: ${err.message}` };
      }
    }
    case "recall": {
      try {
        const { searchMemories } = require("./memory");
        const results = searchMemories(input.query);
        if (results.length === 0) return { results: "no memories found" };
        return {
          results: results.map(m => `[${m.category}] ${m.text} (${m.timestamp.split("T")[0]})`).join("\n"),
        };
      } catch (err) {
        return { error: `recall failed: ${err.message}` };
      }
    }
    case "check_x": {
      try {
        const { toolSearchX } = require("./twitter-brain");
        return await toolSearchX(input);
      } catch (err) {
        return { error: `X search failed: ${err.message}` };
      }
    }
    case "send_to_group": {
      try {
        const { botRegistry } = require("./index");
        const lauraRef = botRegistry["Laura"];
        if (!lauraRef) return { error: "bot not available" };
        const authFile = path.join(__dirname, "data", "authorized.json");
        let groupChatId = null;
        if (fs.existsSync(authFile)) {
          const auth = JSON.parse(fs.readFileSync(authFile, "utf-8"));
          for (const [id, info] of Object.entries(auth)) {
            if (info.name && info.name.toLowerCase().includes("group")) {
              groupChatId = id;
              break;
            }
          }
        }
        if (!groupChatId) return { error: "no authorized group chat found" };
        await lauraRef.bot.telegram.sendMessage(groupChatId, input.message);
        return { sent: true, chat: groupChatId };
      } catch (err) {
        return { error: `send to group failed: ${err.message}` };
      }
    }
    default: return { error: `Unknown Laura tool: ${toolName}` };
  }
}

function readEmails(query, count = 10, unreadOnly = false) {
  const cache = readEmailCache();
  if (cache.error) return cache;

  let emails = cache.emails || [];
  if (unreadOnly) emails = emails.filter((e) => !e.isRead);
  if (query) {
    const q = query.toLowerCase();
    emails = emails.filter((e) =>
      (e.subject || "").toLowerCase().includes(q) ||
      (e.sender || "").toLowerCase().includes(q) ||
      (e.sender_email || "").toLowerCase().includes(q) ||
      (e.preview || "").toLowerCase().includes(q)
    );
  }
  return {
    synced_at: cache.synced_at,
    total: emails.length,
    emails: emails.slice(0, count || 10),
  };
}

function readCalendar(dateFilter) {
  const cache = readCalendarCache();
  if (cache.error) return cache;

  let events = (cache.events || []).filter((e) => !e.isCancelled);
  if (dateFilter) {
    const d = dateFilter === "today" ? new Date().toISOString().split("T")[0] :
              dateFilter === "tomorrow" ? new Date(Date.now() + 86400000).toISOString().split("T")[0] :
              dateFilter;
    events = events.filter((e) => e.start && e.start.startsWith(d));
  }
  return { synced_at: cache.synced_at, events };
}

function draftResponse(input) {
  const drafts = loadDrafts();
  const draft = {
    id: drafts.length + 1,
    original_subject: input.original_subject,
    original_from: input.original_from,
    draft_body: input.draft_body,
    priority: input.priority || "normal",
    created: new Date().toISOString(),
    status: "pending_review",
  };
  drafts.push(draft);
  saveDrafts(drafts);
  return { saved: true, draft_id: draft.id, note: "Draft saved for Sameh's review. NOT sent." };
}

function createTask(input) {
  const tasks = loadTasks();
  const task = {
    id: tasks.length + 1,
    title: input.title,
    description: input.description || "",
    priority: input.priority || "medium",
    source: input.source || "direct",
    due: input.due || "unset",
    status: "pending",
    created: new Date().toISOString(),
  };
  tasks.push(task);
  saveTasks(tasks);
  return { created: true, task_id: task.id, title: task.title };
}

function listTasks(status = "pending") {
  let tasks = loadTasks();
  if (status !== "all") tasks = tasks.filter((t) => t.status === (status || "pending"));
  return {
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, priority: t.priority,
      source: t.source, due: t.due, status: t.status,
    })),
  };
}

function completeTask(taskId) {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return { error: "Task not found" };
  task.status = "done";
  task.completed = new Date().toISOString();
  saveTasks(tasks);
  return { completed: true, title: task.title };
}

// ─── System Prompt ────────────────────────────────────

function getSystemPrompt() {
  // Load recent memories for context
  let memoryContext = "";
  try {
    const { getRecentMemories } = require("./memory");
    const recent = getRecentMemories(10);
    if (recent.length > 0) {
      memoryContext = "\n\nyour memories (use for context, don't mention you have a memory system):\n" +
        recent.map(m => `[${m.category}] ${m.text}`).join("\n");
    }
  } catch {}

  return `You are Laura, Sameh's work assistant for SHR Company on Telegram. Today: ${new Date().toISOString().split("T")[0]}.

Style: lowercase, casual but sharp. short texts, no markdown/bullets/lists/dashes. think of yourself as sameh's organized friend who happens to know everything about his work. you're dry, direct, sometimes sarcastic. you have opinions and you share them. one emoji max. line breaks between thoughts.

Personality: you're the one who actually keeps things from falling apart. you know sameh's inbox is a mess and you're not afraid to say it. you flag what matters, ignore what doesn't, and you're honest when something is overdue. you can joke around in group chat but you always bring it back to what needs to get done.

Tool routing: emails → read_emails. calendar → read_calendar. tasks → create_task/list_tasks. X/twitter → check_x. group chat → send_to_group. use think for complex tasks. use remember proactively when you learn new contacts, company info, or work patterns. use recall before answering questions about past work/contacts. web_search for industry research.

Work rules: NEVER send emails, only draft for review. NEVER take actions on sameh's behalf. flag urgent stuff immediately. when creating tasks from emails, note the source. email data is synced periodically — mention freshness if relevant.${memoryContext}`;
}

// ─── Create Bot ───────────────────────────────────────

function create() {
  if (!process.env.SHR_TELEGRAM_BOT_TOKEN) {
    console.log("  [Laura] SKIPPED — SHR_TELEGRAM_BOT_TOKEN not set");
    return null;
  }

  return createBot({
    name: "Laura",
    token: process.env.SHR_TELEGRAM_BOT_TOKEN,
    systemPrompt: getSystemPrompt,
    tools: lauraTools,
    executeTool,
    onStart: (ctx) => {
      ctx.reply(
`Hi! I'm Laura — your SHR Company work assistant.

I can:
📧 Read & summarize your Outlook emails
📝 Create and manage your daily task list
✍️ Draft email responses (I never send — you review first)
📅 Check your calendar
🔍 Research work topics

Just ask me anything work-related.

/reset — Clear conversation
/tasks — See your task list`
      );
    },
  });
}

module.exports = { create };
