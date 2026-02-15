// gmail.js — Gmail integration for Harvey via Google OAuth2
// Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in .env
// First-time setup: Harvey sends an auth link, user clicks, grants access, token saved.

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "./data";
const TOKEN_FILE = path.join(DATA_DIR, "gmail_token.json");

// Lazy-load googleapis (installed via npm)
let google, OAuth2Client;
function loadGoogleApis() {
  if (google) return;
  const { google: g } = require("googleapis");
  google = g;
  OAuth2Client = g.auth.OAuth2;
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

// ─── OAuth2 Client ──────────────────────────────────

function getOAuthClient() {
  loadGoogleApis();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3456/oauth/callback";

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set in .env");
  }

  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function getAuthUrl() {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

async function handleAuthCallback(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  // Save tokens persistently
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log("[Gmail] Token saved successfully");
  return tokens;
}

function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function isAuthenticated() {
  return !!loadToken();
}

async function getAuthenticatedClient() {
  const client = getOAuthClient();
  const token = loadToken();
  if (!token) throw new Error("Gmail not authenticated. Use gmail_auth tool first.");

  client.setCredentials(token);

  // Auto-refresh if expired
  client.on("tokens", (newTokens) => {
    const existing = loadToken() || {};
    const merged = { ...existing, ...newTokens };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(merged, null, 2));
    console.log("[Gmail] Token refreshed");
  });

  return client;
}

// ─── Gmail Operations ───────────────────────────────

async function getGmail() {
  loadGoogleApis();
  const auth = await getAuthenticatedClient();
  return google.gmail({ version: "v1", auth });
}

// List recent emails
async function listEmails(query = "", maxResults = 10) {
  const gmail = await getGmail();
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  if (!res.data.messages || res.data.messages.length === 0) {
    return { emails: [], total: 0 };
  }

  // Fetch all email details in parallel (was sequential — 10x faster now)
  const details = await Promise.all(
    res.data.messages.map((msg) =>
      gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      })
    )
  );

  const emails = details.map((detail) => {
    const headers = detail.data.payload.headers;
    const getHeader = (name) => {
      const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
      return h ? h.value : "";
    };
    return {
      id: detail.data.id,
      threadId: detail.data.threadId,
      from: getHeader("From"),
      to: getHeader("To"),
      subject: getHeader("Subject"),
      date: getHeader("Date"),
      snippet: detail.data.snippet,
      labels: detail.data.labelIds || [],
      unread: (detail.data.labelIds || []).includes("UNREAD"),
    };
  });

  return { emails, total: res.data.resultSizeEstimate || emails.length };
}

// Read full email
async function readEmail(messageId) {
  const gmail = await getGmail();
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = res.data.payload.headers;
  const getHeader = (name) => {
    const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : "";
  };

  // Extract body text
  let body = "";
  function extractText(payload) {
    if (payload.body && payload.body.data) {
      const decoded = Buffer.from(payload.body.data, "base64url").toString("utf-8");
      if (payload.mimeType === "text/plain") body += decoded;
      else if (payload.mimeType === "text/html" && !body) {
        // Strip HTML tags for a rough text version
        body += decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    if (payload.parts) {
      for (const part of payload.parts) extractText(part);
    }
  }
  extractText(res.data.payload);

  // Truncate very long emails
  if (body.length > 3000) body = body.slice(0, 3000) + "\n...(truncated)";

  return {
    id: res.data.id,
    threadId: res.data.threadId,
    from: getHeader("From"),
    to: getHeader("To"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    body,
    labels: res.data.labelIds || [],
  };
}

// Search emails
async function searchEmails(query, maxResults = 10) {
  return await listEmails(query, maxResults);
}

// Send email
async function sendEmail(to, subject, body, replyToMessageId = null) {
  const gmail = await getGmail();

  // Build the raw email
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];

  if (replyToMessageId) {
    // Fetch the original message to get Message-ID and References headers
    try {
      const orig = await gmail.users.messages.get({
        userId: "me",
        id: replyToMessageId,
        format: "metadata",
        metadataHeaders: ["Message-ID", "References", "In-Reply-To"],
      });
      const origHeaders = orig.data.payload.headers;
      const getH = (n) => {
        const h = origHeaders.find((h) => h.name.toLowerCase() === n.toLowerCase());
        return h ? h.value : "";
      };
      const messageId = getH("Message-ID");
      const references = getH("References");
      if (messageId) {
        lines.push(`In-Reply-To: ${messageId}`);
        lines.push(`References: ${references ? references + " " : ""}${messageId}`);
      }
    } catch {}
  }

  lines.push("", body);
  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");

  const params = { userId: "me", requestBody: { raw } };
  if (replyToMessageId) {
    // Get thread ID for threading
    try {
      const orig = await gmail.users.messages.get({ userId: "me", id: replyToMessageId, format: "minimal" });
      params.requestBody.threadId = orig.data.threadId;
    } catch {}
  }

  const res = await gmail.users.messages.send(params);
  return { sent: true, messageId: res.data.id, threadId: res.data.threadId };
}

// Get unread count
async function getUnreadCount() {
  const gmail = await getGmail();
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread",
    maxResults: 1,
  });
  return { unread: res.data.resultSizeEstimate || 0 };
}

// Get labels
async function getLabels() {
  const gmail = await getGmail();
  const res = await gmail.users.labels.list({ userId: "me" });
  return {
    labels: (res.data.labels || []).map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
    })),
  };
}

// Mark as read
async function markAsRead(messageId) {
  const gmail = await getGmail();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
  return { marked_read: true, id: messageId };
}

// ─── Google Calendar Operations ─────────────────────────

async function getCalendar() {
  loadGoogleApis();
  const auth = await getAuthenticatedClient();
  return google.calendar({ version: "v3", auth });
}

// List upcoming events
async function listEvents(maxResults = 10, timeMin = null, timeMax = null) {
  const calendar = await getCalendar();
  const now = new Date();
  const params = {
    calendarId: "primary",
    timeMin: timeMin || now.toISOString(),
    timeMax: timeMax || null,
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  };
  if (!params.timeMax) delete params.timeMax;

  const res = await calendar.events.list(params);
  return {
    events: (res.data.items || []).map(formatEvent),
    count: (res.data.items || []).length,
  };
}

// Get today's events
async function getTodayEvents() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return listEvents(20, startOfDay.toISOString(), endOfDay.toISOString());
}

// Search events
async function searchEvents(query, maxResults = 10) {
  const calendar = await getCalendar();
  const res = await calendar.events.list({
    calendarId: "primary",
    q: query,
    timeMin: new Date(Date.now() - 30 * 86400000).toISOString(), // past 30 days
    timeMax: new Date(Date.now() + 90 * 86400000).toISOString(), // next 90 days
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });
  return {
    events: (res.data.items || []).map(formatEvent),
    count: (res.data.items || []).length,
  };
}

// Create an event
async function createEvent(summary, startTime, endTime, description = "", location = "", attendees = []) {
  const calendar = await getCalendar();
  const event = {
    summary,
    description,
    location,
    start: { dateTime: startTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: endTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  };
  if (attendees.length > 0) {
    event.attendees = attendees.map((email) => ({ email }));
  }
  const res = await calendar.events.insert({ calendarId: "primary", requestBody: event });
  return { created: true, event: formatEvent(res.data), link: res.data.htmlLink };
}

// Delete an event
async function deleteEvent(eventId) {
  const calendar = await getCalendar();
  await calendar.events.delete({ calendarId: "primary", eventId });
  return { deleted: true, eventId };
}

// Format event for clean output
function formatEvent(event) {
  const start = event.start.dateTime || event.start.date;
  const end = event.end.dateTime || event.end.date;
  const isAllDay = !event.start.dateTime;
  return {
    id: event.id,
    title: event.summary || "(no title)",
    start,
    end,
    all_day: isAllDay,
    location: event.location || "",
    description: event.description ? event.description.slice(0, 200) : "",
    attendees: (event.attendees || []).map((a) => a.email),
    status: event.status,
    link: event.htmlLink,
  };
}

module.exports = {
  getAuthUrl,
  handleAuthCallback,
  isAuthenticated,
  listEmails,
  readEmail,
  searchEmails,
  sendEmail,
  getUnreadCount,
  getLabels,
  markAsRead,
  // Calendar
  listEvents,
  getTodayEvents,
  searchEvents,
  createEvent,
  deleteEvent,
};
