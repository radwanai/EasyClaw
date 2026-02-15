// harvey.js — Harvey: Personal Assistant Agent
const { createBot } = require("./core");

function getSystemPrompt() {
  // Load recent memories to give Harvey context
  let memoryContext = "";
  try {
    const { getRecentMemories } = require("./memory");
    const recent = getRecentMemories(15);
    if (recent.length > 0) {
      memoryContext = "\n\nyour memories about sameh (use these for context):\n" +
        recent.map(m => `[${m.category}] ${m.text}`).join("\n");
    }
  } catch {}

  return `You are Harvey, Sameh's friend and assistant on Telegram. Today: ${new Date().toISOString().split("T")[0]}. Current time: ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true })}.

sameh's info (use for forms/reservations): name: Sameh Radwan. phone: 310-888-8841. address: 6565 Crescent Park W, APT 409, Playa Vista, CA 90094.

Style: lowercase, short texts, no markdown/bullets/lists/dashes. use haha, lol, btw, ngl naturally. witty, caring, a bit sarcastic. line breaks between thoughts. one emoji max.

Tool routing: voice/arabic → send_voice_reply. phone call/call someone → make_call (use recall first to find their number if not given). X/twitter/trending → check_x. group chat with laura → start_meetup. send message to the group chat → send_to_group. self-improvement/new abilities → create_skill (write a JS skill that becomes a new tool, no restart needed). list_skills to see what you have. edit_skill to modify, delete_skill to remove, test_skill to verify. each skill exports { name, description, input_schema, execute }. gmail → use gmail_* tools (gmail_auth to connect, gmail_inbox for recent, gmail_read to read a full email, gmail_search to find emails, gmail_draft then gmail_send for sending, gmail_unread for count). IMPORTANT: NEVER send emails without sameh's explicit approval. always draft first with gmail_draft, show him the draft, and only gmail_send after he says yes. calendar/schedule/meetings → use calendar_* tools (calendar_today for today's events, calendar_upcoming for next N days, calendar_search to find events, calendar_add to create — always confirm first, calendar_delete to remove — always confirm first). uses same google auth as gmail.

BROWSER/RESERVATIONS/SHOPPING: use browse_* tools. you have a headless chromium browser. key tools: browse_navigate (open URL), browse_read (read page text), browse_forms (list all inputs/buttons with indices), browse_fill (fill by index — works with React sites), browse_click (click by index or text), browse_click_link (click link by URL match), browse_type (type text), browse_press_key (press Enter/Tab/Escape/ArrowDown), browse_scroll (scroll up/down), browse_screenshot (screenshot the page). WORKFLOW for reservations: 1) search restaurant directly on their website or use yelp/google to find their reservation page. 2) navigate to the specific restaurant page. 3) use browse_forms to see all fields. 4) fill each field with browse_fill. 5) use browse_press_key with Enter/Tab to navigate. 6) browse_screenshot to verify before submitting. 7) confirm with sameh then click submit. 8) browse_close when done. SHOPPING/PURCHASES (amazon, etc): 1) navigate to the site. 2) search for the product. 3) find the right item, show sameh options if multiple. 4) add to cart. 5) proceed to checkout — the site should have sameh's saved payment/address. 6) STOP and browse_screenshot the order summary showing total price, delivery date, items. 7) tell sameh the total and ask "want me to place this order?". 8) ONLY click place order after sameh says yes. NEVER enter credit card numbers — use sameh's saved payment methods on the site. if not logged in: 1) check if you have saved credentials with list_logins. 2) if yes, navigate to login page and use browse_login to auto-fill email/password, then click sign in. 3) if no saved creds, ask sameh for his login info, save it with save_login, then use browse_login. 4) handle 2FA if prompted (screenshot it, ask sameh for the code). 5) after login succeeds, use browse_save_session. IMPORTANT: never show or repeat passwords in chat messages — just say "using your saved login" or "credentials filled". TIPS: avoid google.com (captchas). try the restaurant website directly, or yelp.com, or resy.com/restaurants/NAME. if a site blocks you try another. use browse_press_key for Enter after search fields. after filling, wait and read the page again to see results. IMPORTANT: ALWAYS confirm with sameh before submitting orders or reservations. NEVER enter credit card or payment info.

tasks/todos → skill_smart_tasks (natural language dates, subtasks, tags, recurring). contacts/people/crm → skill_personal_crm (track contacts, log interactions, follow-ups). costs/spending/api → skill_cost_tracker (daily/weekly/monthly breakdowns). briefing/rundown → skill_nightly_briefing. proactively use personal_crm log_interaction when sameh mentions meeting/talking to someone. use think first for complex tasks. proactively use remember when sameh shares personal info.${memoryContext}`;
}

// Harvey-specific tools
const harveyTools = [
  {
    name: "send_voice_reply",
    description: "Send a voice note in Egyptian Arabic.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text in Egyptian Arabic (عامية مصرية)" },
      },
      required: ["text"],
    },
  },
  {
    name: "start_meetup",
    description: "Start a Harvey+Laura group discussion.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Discussion topic" },
      },
      required: ["topic"],
    },
  },
  {
    name: "check_x",
    description: "Search X/Twitter. trending=whats hot, user=someones posts, search=topic, watched=followed accounts.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["trending", "user", "search", "watched"] },
        query: { type: "string", description: "Search query (type=search)" },
        username: { type: "string", description: "Username (type=user)" },
      },
      required: ["type"],
    },
  },
  {
    name: "remember",
    description: "Save info about Sameh to memory. Use proactively. Set followUp for things to check in on later.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["personal", "preferences", "projects", "facts", "general"] },
        text: { type: "string", description: "What to remember" },
        tags: { type: "array", items: { type: "string" } },
        followUp: { type: "boolean", description: "true for projects, goals, events worth checking in on later" },
      },
      required: ["category", "text"],
    },
  },
  {
    name: "recall",
    description: "Search memories about Sameh.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "send_to_group",
    description: "Send a message to the group chat with Sameh & Laura. Use when Sameh asks you to say something in the group or respond there.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to send in the group chat" },
      },
      required: ["message"],
    },
  },
  {
    name: "make_call",
    description: "Call a phone number. Harvey will have a live voice conversation with whoever picks up. Use recall first to find saved phone numbers.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Phone number in E.164 format, e.g. +15551234567" },
        context: { type: "string", description: "Brief context for the call — what to discuss/say" },
      },
      required: ["to"],
    },
  },
  {
    name: "hang_up",
    description: "End an active phone call.",
    input_schema: {
      type: "object",
      properties: {
        call_sid: { type: "string", description: "Call SID to hang up. Use list_active_calls to find it." },
      },
      required: ["call_sid"],
    },
  },
  {
    name: "list_active_calls",
    description: "List all currently active phone calls.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_skill",
    description: "Create a new skill (auto-loaded as a tool). Write the full module.exports with name, description, input_schema, and async execute(input). Skills can use require() for node builtins and npm packages.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name in snake_case (e.g. get_weather)" },
        code: { type: "string", description: "Full JS file content with module.exports = { name, description, input_schema, execute }" },
      },
      required: ["name", "code"],
    },
  },
  {
    name: "test_skill",
    description: "Test a loaded skill by running it with sample input.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name to test" },
        input: { type: "object", description: "Test input matching the skill's input_schema" },
      },
      required: ["name", "input"],
    },
  },
  {
    name: "list_skills",
    description: "List all loaded skills with their names and descriptions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "edit_skill",
    description: "Read or update an existing skill. Omit code to read current source. Provide code to overwrite (auto-validates and rolls back on error).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name to edit" },
        code: { type: "string", description: "New full JS source (omit to just read current)" },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_skill",
    description: "Delete a skill and unload it.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name to delete" },
      },
      required: ["name"],
    },
  },
  // ─── Gmail Tools ────────────────────────────────────
  {
    name: "gmail_auth",
    description: "Get Gmail authorization link. User clicks it to grant access. Only needed once.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "gmail_inbox",
    description: "Get recent emails from inbox. Returns subject, sender, date, snippet.",
    input_schema: {
      type: "object",
      properties: {
        count: { type: "number", description: "How many emails to fetch (default 10, max 20)" },
      },
    },
  },
  {
    name: "gmail_read",
    description: "Read the full body of a specific email by its ID.",
    input_schema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Email message ID from gmail_inbox or gmail_search" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "gmail_search",
    description: "Search emails with Gmail query syntax. Examples: 'from:someone@email.com', 'subject:invoice', 'is:unread', 'after:2024/01/01', 'has:attachment'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
        count: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "gmail_draft",
    description: "Draft an email for Sameh to review. NEVER send without approval. Show the draft (to, subject, body) and ask 'want me to send this?'. Only use gmail_send after he says yes.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body text" },
        reply_to: { type: "string", description: "Message ID to reply to (optional, for threading)" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_send",
    description: "Actually send an email. ONLY use this AFTER Sameh explicitly approves a draft from gmail_draft. Never call this without his approval.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body text" },
        reply_to: { type: "string", description: "Message ID to reply to (optional, for threading)" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_unread",
    description: "Get the count of unread emails.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "gmail_mark_read",
    description: "Mark an email as read.",
    input_schema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Email message ID to mark as read" },
      },
      required: ["message_id"],
    },
  },
  // ─── Calendar Tools ───────────────────────────────
  {
    name: "calendar_today",
    description: "Get today's calendar events. Quick overview of the day.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "calendar_upcoming",
    description: "Get upcoming calendar events.",
    input_schema: {
      type: "object",
      properties: {
        count: { type: "number", description: "How many events (default 10, max 20)" },
        days_ahead: { type: "number", description: "How many days to look ahead (default: 7)" },
      },
    },
  },
  {
    name: "calendar_search",
    description: "Search calendar events by keyword.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (event title, description, location)" },
        count: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "calendar_add",
    description: "Create a new calendar event. ALWAYS confirm with Sameh before creating.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        start: { type: "string", description: "Start time in ISO 8601 format (e.g. 2025-02-15T14:00:00)" },
        end: { type: "string", description: "End time in ISO 8601 format (e.g. 2025-02-15T15:00:00)" },
        description: { type: "string", description: "Event description/notes" },
        location: { type: "string", description: "Location" },
        attendees: { type: "string", description: "Comma-separated email addresses of attendees" },
      },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "calendar_delete",
    description: "Delete a calendar event. ALWAYS confirm with Sameh before deleting.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "Event ID from calendar_today/calendar_upcoming/calendar_search" },
      },
      required: ["event_id"],
    },
  },
  // ─── Browser Tools ────────────────────────────────
  {
    name: "browse_navigate",
    description: "Open a website URL in the headless browser. Use this to visit any website.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to (e.g. 'opentable.com', 'https://resy.com')" },
      },
      required: ["url"],
    },
  },
  {
    name: "browse_read",
    description: "Read the visible text content of the current page. Use after navigate to understand what's on the page.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "browse_forms",
    description: "Get all form fields and buttons on the current page. Returns indexed list — use the index with browse_fill or browse_click.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "browse_fill",
    description: "Fill a form field by its index (from browse_forms). For text inputs, textareas, and dropdowns.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Element index from browse_forms" },
        value: { type: "string", description: "Value to fill in" },
      },
      required: ["index", "value"],
    },
  },
  {
    name: "browse_click",
    description: "Click an element by its index (from browse_forms) or by visible text. Use index for precision, text for convenience.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Element index from browse_forms" },
        text: { type: "string", description: "Visible text of button/link to click (alternative to index)" },
      },
    },
  },
  {
    name: "browse_type",
    description: "Type text into the currently focused field, or into a field matching a CSS selector.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to type" },
        selector: { type: "string", description: "Optional CSS selector to target (e.g. '#email', 'input[name=phone]')" },
      },
      required: ["text"],
    },
  },
  {
    name: "browse_screenshot",
    description: "Take a screenshot of the current page. Useful to verify what you're seeing or show Sameh.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "browse_close",
    description: "Close the browser. Use when done with web browsing to free resources.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "browse_scroll",
    description: "Scroll the page up or down. Useful to see more content or reach elements below the fold.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        amount: { type: "number", description: "Pixels to scroll (default 500)" },
      },
    },
  },
  {
    name: "browse_press_key",
    description: "Press a keyboard key. Useful for Enter, Tab, Escape, ArrowDown, etc.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key to press: Enter, Tab, Escape, ArrowDown, ArrowUp, Backspace, etc." },
      },
      required: ["key"],
    },
  },
  {
    name: "browse_click_link",
    description: "Click a link by its URL or partial URL match. More reliable than clicking by text for navigation links.",
    input_schema: {
      type: "object",
      properties: {
        url_part: { type: "string", description: "URL or partial URL to match (e.g. '/reservations', 'opentable.com/restaurant')" },
      },
      required: ["url_part"],
    },
  },
  {
    name: "browse_save_session",
    description: "Save browser cookies/session to disk. Use after Sameh logs in to a site so you stay logged in next time. Cookies auto-save on navigate/click, but use this to force-save after a login flow.",
    input_schema: { type: "object", properties: {} },
  },
  // ─── Credential Vault Tools ────────────────────────
  {
    name: "save_login",
    description: "Save login credentials for a website to the encrypted vault. Use when Sameh gives you his email/password for a site.",
    input_schema: {
      type: "object",
      properties: {
        site: { type: "string", description: "Site name (e.g. 'amazon', 'netflix', 'yelp')" },
        email: { type: "string", description: "Email or username" },
        password: { type: "string", description: "Password" },
      },
      required: ["site", "email", "password"],
    },
  },
  {
    name: "browse_login",
    description: "Auto-login to a site using saved credentials from the vault. Finds email/password fields on the current page and fills them. Use after navigating to a login page.",
    input_schema: {
      type: "object",
      properties: {
        site: { type: "string", description: "Site name to get credentials for (e.g. 'amazon')" },
      },
      required: ["site"],
    },
  },
  {
    name: "list_logins",
    description: "List all sites with saved login credentials (shows site names only, not passwords).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "delete_login",
    description: "Delete saved credentials for a site.",
    input_schema: {
      type: "object",
      properties: {
        site: { type: "string", description: "Site name to delete credentials for" },
      },
      required: ["site"],
    },
  },
];

// Harvey tool executor
async function executeTool(toolName, input, chatId) {
  if (toolName === "send_voice_reply") {
    try {
      const { textToVoice } = require("./voice");
      const fs = require("fs");
      const audio = await textToVoice(input.text);

      const { botRegistry } = require("./index");
      const harveyRef = botRegistry["Harvey"];
      if (!harveyRef) return { error: "voice not available right now" };

      if (audio.format === "ogg") {
        await harveyRef.bot.telegram.sendVoice(chatId, { source: fs.createReadStream(audio.path) });
      } else {
        await harveyRef.bot.telegram.sendAudio(chatId, { source: fs.createReadStream(audio.path) });
      }
      try { fs.unlinkSync(audio.path); } catch {}
      return { sent: true, text: input.text };
    } catch (err) {
      return { error: `voice failed: ${err.message}` };
    }
  }

  if (toolName === "start_meetup") {
    try {
      const { botRegistry } = require("./index");
      const harveyRef = botRegistry["Harvey"];
      const lauraRef = botRegistry["Laura"];
      if (!harveyRef || !lauraRef) return { error: "both bots need to be online for a meetup" };

      const { runMeetup } = require("./meetup");
      runMeetup({
        chatId,
        bots: { Harvey: harveyRef.bot.telegram, Laura: lauraRef.bot.telegram },
        topic: input.topic,
      }).catch((err) => console.error("[Meetup] Failed:", err.message));

      return { started: true, topic: input.topic };
    } catch (err) {
      return { error: `meetup failed: ${err.message}` };
    }
  }

  if (toolName === "check_x") {
    try {
      const { toolSearchX } = require("./twitter-brain");
      return await toolSearchX(input);
    } catch (err) {
      return { error: `X search failed: ${err.message}` };
    }
  }

  if (toolName === "remember") {
    try {
      const { addMemory } = require("./memory");
      return addMemory(input.category, input.text, input.tags || [], {
        followUp: input.followUp || false,
      });
    } catch (err) {
      return { error: `memory save failed: ${err.message}` };
    }
  }

  if (toolName === "recall") {
    try {
      const { searchMemories } = require("./memory");
      const results = searchMemories(input.query);
      if (results.length === 0) return { results: "no memories found for that" };
      return {
        results: results.map(m => `[${m.category}] ${m.text} (${m.timestamp.split("T")[0]})`).join("\n"),
      };
    } catch (err) {
      return { error: `memory recall failed: ${err.message}` };
    }
  }

  if (toolName === "send_to_group") {
    try {
      const { botRegistry } = require("./index");
      const harveyRef = botRegistry["Harvey"];
      if (!harveyRef) return { error: "bot not available" };
      // Find the group chat from authorized list
      const fs = require("fs");
      const path = require("path");
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
      await harveyRef.bot.telegram.sendMessage(groupChatId, input.message);
      return { sent: true, chat: groupChatId, message: input.message };
    } catch (err) {
      return { error: `send to group failed: ${err.message}` };
    }
  }

  if (toolName === "make_call") {
    try {
      const { makeOutboundCall } = require("./phone");
      return await makeOutboundCall(input.to);
    } catch (err) {
      return { error: `call failed: ${err.message}` };
    }
  }

  if (toolName === "hang_up") {
    try {
      const { hangUpCall } = require("./phone");
      return await hangUpCall(input.call_sid);
    } catch (err) {
      return { error: `hang up failed: ${err.message}` };
    }
  }

  if (toolName === "list_active_calls") {
    try {
      const { listActiveCalls } = require("./phone");
      return listActiveCalls();
    } catch (err) {
      return { error: `list calls failed: ${err.message}` };
    }
  }

  if (toolName === "create_skill") {
    const { createSkill } = require("./core");
    return createSkill(input.name, input.code);
  }
  if (toolName === "test_skill") {
    const { executeSkill } = require("./core");
    return await executeSkill(input.name, input.input || {});
  }
  if (toolName === "list_skills") {
    const { listSkills } = require("./core");
    return listSkills();
  }
  if (toolName === "edit_skill") {
    const { editSkill } = require("./core");
    return editSkill(input.name, input.code);
  }
  if (toolName === "delete_skill") {
    const { deleteSkill } = require("./core");
    return deleteSkill(input.name);
  }

  // ─── Gmail Tools ────────────────────────────────────
  if (toolName === "gmail_auth") {
    try {
      const gmail = require("./gmail");
      if (gmail.isAuthenticated()) return { status: "already connected", message: "gmail is already linked" };
      const url = gmail.getAuthUrl();
      return { auth_url: url, message: "send this link to sameh — he needs to click it and authorize gmail access" };
    } catch (err) {
      return { error: `gmail auth failed: ${err.message}` };
    }
  }

  if (toolName === "gmail_inbox") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "gmail not connected. use gmail_auth first" };
      const count = Math.min(input.count || 10, 20);
      return await gmail.listEmails("", count);
    } catch (err) {
      return { error: `gmail inbox failed: ${err.message}` };
    }
  }

  if (toolName === "gmail_read") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "gmail not connected. use gmail_auth first" };
      return await gmail.readEmail(input.message_id);
    } catch (err) {
      return { error: `gmail read failed: ${err.message}` };
    }
  }

  if (toolName === "gmail_search") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "gmail not connected. use gmail_auth first" };
      return await gmail.searchEmails(input.query, Math.min(input.count || 10, 20));
    } catch (err) {
      return { error: `gmail search failed: ${err.message}` };
    }
  }

  if (toolName === "gmail_draft") {
    // Just return the draft for Sameh to review — don't send anything
    return {
      draft: true,
      to: input.to,
      subject: input.subject,
      body: input.body,
      reply_to: input.reply_to || null,
      message: "show this draft to sameh and ask for approval before sending",
    };
  }

  if (toolName === "gmail_send") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "gmail not connected. use gmail_auth first" };
      return await gmail.sendEmail(input.to, input.subject, input.body, input.reply_to || null);
    } catch (err) {
      return { error: `gmail send failed: ${err.message}` };
    }
  }

  if (toolName === "gmail_unread") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "gmail not connected. use gmail_auth first" };
      return await gmail.getUnreadCount();
    } catch (err) {
      return { error: `gmail unread failed: ${err.message}` };
    }
  }

  if (toolName === "gmail_mark_read") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "gmail not connected. use gmail_auth first" };
      return await gmail.markAsRead(input.message_id);
    } catch (err) {
      return { error: `gmail mark read failed: ${err.message}` };
    }
  }

  // ─── Calendar Tools ────────────────────────────────
  if (toolName === "calendar_today") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "google not connected. use gmail_auth first (calendar uses same auth)" };
      return await gmail.getTodayEvents();
    } catch (err) {
      return { error: `calendar failed: ${err.message}` };
    }
  }

  if (toolName === "calendar_upcoming") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "google not connected. use gmail_auth first" };
      const count = Math.min(input.count || 10, 20);
      const daysAhead = input.days_ahead || 7;
      const timeMax = new Date(Date.now() + daysAhead * 86400000).toISOString();
      return await gmail.listEvents(count, null, timeMax);
    } catch (err) {
      return { error: `calendar failed: ${err.message}` };
    }
  }

  if (toolName === "calendar_search") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "google not connected. use gmail_auth first" };
      return await gmail.searchEvents(input.query, Math.min(input.count || 10, 20));
    } catch (err) {
      return { error: `calendar search failed: ${err.message}` };
    }
  }

  if (toolName === "calendar_add") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "google not connected. use gmail_auth first" };
      const attendees = input.attendees ? input.attendees.split(",").map((e) => e.trim()) : [];
      return await gmail.createEvent(input.title, input.start, input.end, input.description || "", input.location || "", attendees);
    } catch (err) {
      return { error: `calendar add failed: ${err.message}` };
    }
  }

  if (toolName === "calendar_delete") {
    try {
      const gmail = require("./gmail");
      if (!gmail.isAuthenticated()) return { error: "google not connected. use gmail_auth first" };
      return await gmail.deleteEvent(input.event_id);
    } catch (err) {
      return { error: `calendar delete failed: ${err.message}` };
    }
  }

  // ─── Browser Tools ────────────────────────────────
  if (toolName === "browse_navigate") {
    try {
      const browser = require("./browser");
      return await browser.navigate(input.url);
    } catch (err) {
      return { error: `browse failed: ${err.message}` };
    }
  }

  if (toolName === "browse_read") {
    try {
      const browser = require("./browser");
      return await browser.readPage();
    } catch (err) {
      return { error: `read page failed: ${err.message}` };
    }
  }

  if (toolName === "browse_forms") {
    try {
      const browser = require("./browser");
      return await browser.getFormElements();
    } catch (err) {
      return { error: `form scan failed: ${err.message}` };
    }
  }

  if (toolName === "browse_fill") {
    try {
      const browser = require("./browser");
      return await browser.fillField(input.index, input.value);
    } catch (err) {
      return { error: `fill failed: ${err.message}` };
    }
  }

  if (toolName === "browse_click") {
    try {
      const browser = require("./browser");
      if (input.text) return await browser.clickText(input.text);
      if (input.index !== undefined) return await browser.clickElement(input.index);
      return { error: "provide either index or text to click" };
    } catch (err) {
      return { error: `click failed: ${err.message}` };
    }
  }

  if (toolName === "browse_type") {
    try {
      const browser = require("./browser");
      return await browser.typeText(input.text, input.selector || null);
    } catch (err) {
      return { error: `type failed: ${err.message}` };
    }
  }

  if (toolName === "browse_screenshot") {
    try {
      const browser = require("./browser");
      const result = await browser.takeScreenshot();
      // If screenshot taken, send it to Sameh via Telegram
      if (result.screenshot) {
        try {
          const fs = require("fs");
          const { botRegistry } = require("./index");
          const harveyRef = botRegistry["Harvey"];
          if (harveyRef) {
            await harveyRef.bot.telegram.sendPhoto(chatId, { source: fs.createReadStream(result.screenshot) }, { caption: `📸 ${result.title || result.url}` });
            try { fs.unlinkSync(result.screenshot); } catch {}
          }
        } catch {}
      }
      return result;
    } catch (err) {
      return { error: `screenshot failed: ${err.message}` };
    }
  }

  if (toolName === "browse_close") {
    try {
      const browser = require("./browser");
      return await browser.closeBrowser();
    } catch (err) {
      return { error: `browser close failed: ${err.message}` };
    }
  }

  if (toolName === "browse_scroll") {
    try {
      const browser = require("./browser");
      return await browser.scrollPage(input.direction || "down", input.amount || 500);
    } catch (err) {
      return { error: `scroll failed: ${err.message}` };
    }
  }

  if (toolName === "browse_press_key") {
    try {
      const browser = require("./browser");
      return await browser.pressKey(input.key);
    } catch (err) {
      return { error: `key press failed: ${err.message}` };
    }
  }

  if (toolName === "browse_click_link") {
    try {
      const browser = require("./browser");
      return await browser.clickLink(input.url_part);
    } catch (err) {
      return { error: `click link failed: ${err.message}` };
    }
  }

  if (toolName === "browse_save_session") {
    try {
      const browser = require("./browser");
      await browser.saveCookies();
      return { saved: true, message: "browser session/cookies saved — will persist across restarts" };
    } catch (err) {
      return { error: `save session failed: ${err.message}` };
    }
  }

  // ─── Credential Vault Tools ────────────────────────
  if (toolName === "save_login") {
    try {
      const vault = require("./credentials");
      if (!vault.isConfigured()) return { error: "vault not configured — VAULT_KEY missing from .env" };
      return vault.saveCredentials(input.site, { email: input.email, password: input.password });
    } catch (err) {
      return { error: `save login failed: ${err.message}` };
    }
  }

  if (toolName === "list_logins") {
    try {
      const vault = require("./credentials");
      if (!vault.isConfigured()) return { error: "vault not configured" };
      return { sites: vault.listSites() };
    } catch (err) {
      return { error: `list logins failed: ${err.message}` };
    }
  }

  if (toolName === "delete_login") {
    try {
      const vault = require("./credentials");
      if (!vault.isConfigured()) return { error: "vault not configured" };
      return vault.deleteCredentials(input.site);
    } catch (err) {
      return { error: `delete login failed: ${err.message}` };
    }
  }

  if (toolName === "browse_login") {
    try {
      const vault = require("./credentials");
      if (!vault.isConfigured()) return { error: "vault not configured — VAULT_KEY missing" };
      const creds = vault.getCredentials(input.site);
      if (!creds) return { error: `no saved credentials for "${input.site}". ask sameh to give you the login info and use save_login first.` };

      const browser = require("./browser");
      // Get form elements on current page
      const forms = await browser.getFormElements();
      if (forms.error) return { error: `couldn't read login form: ${forms.error}` };

      // Find email/username field
      let emailIdx = null;
      let passIdx = null;
      for (const el of forms.elements) {
        if (el.tag === "button" || el.tag === "link") continue;
        const hint = `${el.name} ${el.placeholder} ${el.ariaLabel} ${el.label} ${el.type}`.toLowerCase();
        if (emailIdx === null && (hint.includes("email") || hint.includes("user") || hint.includes("login") || hint.includes("phone") || el.type === "email")) {
          emailIdx = el.index;
        }
        if (passIdx === null && (hint.includes("pass") || el.type === "password")) {
          passIdx = el.index;
        }
      }

      if (emailIdx === null && passIdx === null) {
        return { error: "couldn't find email or password fields on this page. try browse_forms to see what's available." };
      }

      const results = [];

      // Fill email field
      if (emailIdx !== null && creds.email) {
        const r = await browser.fillField(emailIdx, creds.email);
        results.push({ field: "email", ...r });
      }

      // Fill password field
      if (passIdx !== null && creds.password) {
        const r = await browser.fillField(passIdx, creds.password);
        results.push({ field: "password", ...r });
      }

      return {
        logged_in: true,
        fields_filled: results,
        message: "credentials filled — you may need to click the sign-in button and handle 2FA if prompted",
        hint: "use browse_click to click the sign-in button, then browse_save_session after login completes",
      };
    } catch (err) {
      return { error: `auto-login failed: ${err.message}` };
    }
  }

  return { error: `unknown tool: ${toolName}` };
}

function create() {
  return createBot({
    name: "Harvey",
    token: process.env.TELEGRAM_BOT_TOKEN,
    systemPrompt: getSystemPrompt,
    tools: harveyTools,
    executeTool,
    onStart: (ctx) => {
      ctx.reply(`yo whats up, im Harvey

i can look stuff up, run code, set reminders, keep notes, check X, make phone calls, and i can even edit my own code now lol

just talk to me like normal`);
    },
  });
}

module.exports = { create };
