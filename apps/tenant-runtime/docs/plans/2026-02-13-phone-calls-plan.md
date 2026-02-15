# Phone Calls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Harvey the ability to make and receive real phone calls via Twilio with live two-way AI voice conversation and full tool access.

**Architecture:** Twilio connects calls via WebSocket Media Streams to a WebSocket server running alongside the dashboard HTTP server. Audio flows bidirectionally: caller audio → ElevenLabs STT → Claude (with tools) → ElevenLabs TTS → back to caller. Each call gets its own conversation context.

**Tech Stack:** Twilio (calls + TwiML), ws (WebSocket server), localtunnel (public URL), ElevenLabs (STT/TTS via existing voice.js)

---

### Task 1: Install npm dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add twilio, ws, and localtunnel to package.json**

```json
{
  "name": "clawdbot",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": { "start": "node index.js" },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "dotenv": "^16.0.0",
    "localtunnel": "^2.0.2",
    "telegraf": "^4.16.0",
    "twilio": "^5.5.0",
    "ws": "^8.18.0"
  }
}
```

**Step 2: Verify**

Run: `cd /Users/samehradwan/clawdbot && cat package.json`
Expected: dependencies include twilio, ws, localtunnel

**Step 3: Commit**

```bash
git add package.json
git commit -m "deps: add twilio, ws, localtunnel for phone call support"
```

---

### Task 2: Add Twilio env vars to .env

**Files:**
- Modify: `.env` (append 3 lines)

**Step 1: Append Twilio credentials**

Add to end of `.env`:
```
TWILIO_ACCOUNT_SID=<user must fill in>
TWILIO_AUTH_TOKEN=<user must fill in>
TWILIO_PHONE_NUMBER=+14235086893
```

**Note:** The user needs to paste their actual Account SID and Auth Token from their Twilio console. DO NOT hardcode credentials — prompt the user to add them.

**Step 2: Verify**

Run: `grep TWILIO .env`
Expected: 3 TWILIO_ lines present

---

### Task 3: Refactor dashboard-server.js to export the HTTP server

**Files:**
- Modify: `dashboard-server.js:62-92`

**Why:** Currently dashboard-server.js creates an HTTP server and keeps it internal. We need to export it so phone.js can attach a WebSocket server to the same port (3456). The server must also handle Twilio webhook POST routes.

**Step 1: Modify server creation to export it and add body parsing for POST routes**

Replace lines 62-92 of `dashboard-server.js` with:

```javascript
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        // Twilio sends application/x-www-form-urlencoded
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
```

**Step 2: Verify**

Run: `grep "module.exports" dashboard-server.js`
Expected: `module.exports = server;`

**Step 3: Update index.js to capture the server reference**

In `index.js`, change line 65 from:
```javascript
    require("./dashboard-server");
```
to:
```javascript
    const server = require("./dashboard-server");
```

**Step 4: Commit**

```bash
git add dashboard-server.js index.js
git commit -m "refactor: export HTTP server from dashboard for WebSocket attachment"
```

---

### Task 4: Create phone.js — Core phone call system

**Files:**
- Create: `phone.js`

**This is the main new file.** It handles:
- WebSocket server for Twilio Media Streams (bidirectional audio)
- Inbound call handling (TwiML response)
- Outbound call initiation
- Per-call audio loop: buffer → STT → Claude → TTS → stream back
- Silence detection
- Tool access during calls via Claude agent loop
- Call session management

**Step 1: Create phone.js with full implementation**

```javascript
// phone.js — Twilio Phone Call System for Harvey
const { WebSocketServer } = require("ws");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "LXrTqFIgiubkrMkwvOUr";
const MODEL_ID = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const MODEL = process.env.MODEL || "claude-sonnet-4-5-20250929";
const SILENCE_THRESHOLD_MS = parseInt(process.env.SILENCE_THRESHOLD_MS || "1500", 10);
const MAX_CALL_DURATION_MS = 30 * 60 * 1000; // 30 minutes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let twilioClient = null;
let publicUrl = null;
const activeCalls = new Map();

// ─── Call Session ─────────────────────────────────

class CallSession {
  constructor(callSid, streamSid, ws, direction, callerNumber) {
    this.callSid = callSid;
    this.streamSid = streamSid;
    this.ws = ws;
    this.direction = direction; // "inbound" or "outbound"
    this.callerNumber = callerNumber;
    this.history = [];
    this.audioBuffer = [];
    this.silenceTimer = null;
    this.isProcessing = false;
    this.startTime = Date.now();
    this.turnCount = 0;

    // Auto-end after max duration
    this.maxDurationTimer = setTimeout(() => {
      this.endCall("max duration reached");
    }, MAX_CALL_DURATION_MS);
  }

  addMessage(role, content) {
    this.history.push({ role, content });
    // Keep last 20 messages
    if (this.history.length > 20) this.history.splice(0, this.history.length - 20);
  }

  async endCall(reason) {
    clearTimeout(this.maxDurationTimer);
    clearTimeout(this.silenceTimer);
    activeCalls.delete(this.callSid);

    console.log(`[Phone] Call ${this.callSid} ended: ${reason} (${this.turnCount} turns, ${Math.round((Date.now() - this.startTime) / 1000)}s)`);

    // Hang up via Twilio
    try {
      if (twilioClient) {
        await twilioClient.calls(this.callSid).update({ status: "completed" });
      }
    } catch {}

    // Send summary to Sameh on Telegram
    try {
      if (OWNER_CHAT_ID && this.turnCount > 0) {
        const { botRegistry } = require("./index");
        const harveyRef = botRegistry["Harvey"];
        if (harveyRef) {
          const duration = Math.round((Date.now() - this.startTime) / 1000);
          const summary = `📞 call ended with ${this.callerNumber || "unknown"}\n${this.direction} · ${duration}s · ${this.turnCount} turns\nreason: ${reason}`;
          await harveyRef.bot.telegram.sendMessage(OWNER_CHAT_ID, summary);
        }
      }
    } catch {}
  }
}

// ─── Audio Utilities ─────────────────────────────

// Convert mulaw 8kHz (Twilio format) to PCM buffer for STT
function mulawToLinear(mulawBuffer) {
  const MULAW_BIAS = 33;
  const MULAW_MAX = 0x1FFF;
  const pcm = Buffer.alloc(mulawBuffer.length * 2);

  for (let i = 0; i < mulawBuffer.length; i++) {
    let mulaw = ~mulawBuffer[i] & 0xFF;
    const sign = mulaw & 0x80;
    const exponent = (mulaw >> 4) & 0x07;
    let mantissa = mulaw & 0x0F;
    mantissa = (mantissa << 1) | 0x21;
    mantissa <<= exponent;
    mantissa -= MULAW_BIAS;
    const sample = sign ? -mantissa : mantissa;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return pcm;
}

// Check if audio chunk is mostly silence (low energy)
function isLowEnergy(pcmBuffer, threshold = 500) {
  let sum = 0;
  for (let i = 0; i < pcmBuffer.length - 1; i += 2) {
    sum += Math.abs(pcmBuffer.readInt16LE(i));
  }
  const avg = sum / (pcmBuffer.length / 2);
  return avg < threshold;
}

// Convert PCM buffer to WAV for ElevenLabs STT
function pcmToWav(pcmBuffer, sampleRate = 8000) {
  const header = Buffer.alloc(44);
  const dataSize = pcmBuffer.length;
  const fileSize = dataSize + 36;

  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// ─── ElevenLabs STT ──────────────────────────────

async function speechToText(pcmBuffer) {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");

  const wavBuffer = pcmToWav(pcmBuffer);
  const blob = new Blob([wavBuffer], { type: "audio/wav" });

  const formData = new FormData();
  formData.append("file", blob, "audio.wav");
  formData.append("model_id", "scribe_v1");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`STT error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.text || "";
}

// ─── ElevenLabs TTS → Twilio mulaw ───────────────

async function textToMulaw(text) {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");

  // Request mulaw 8000Hz directly from ElevenLabs (Twilio's native format)
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/basic", // mulaw 8kHz
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
      output_format: "ulaw_8000",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`TTS error ${response.status}: ${err}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

// Send mulaw audio back to Twilio via WebSocket
function streamAudioToTwilio(session, mulawBuffer) {
  if (!session.ws || session.ws.readyState !== 1) return;

  // Twilio expects base64-encoded audio in JSON messages
  // Send in chunks of 640 bytes (80ms at 8kHz mulaw)
  const chunkSize = 640;
  for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
    const chunk = mulawBuffer.slice(i, i + chunkSize);
    const msg = JSON.stringify({
      event: "media",
      streamSid: session.streamSid,
      media: {
        payload: chunk.toString("base64"),
      },
    });
    try {
      session.ws.send(msg);
    } catch {}
  }
}

// ─── Claude Conversation (with tools) ────────────

function getPhoneSystemPrompt() {
  let memoryContext = "";
  try {
    const { getRecentMemories } = require("./memory");
    const recent = getRecentMemories(15);
    if (recent.length > 0) {
      memoryContext = "\n\nyour memories about sameh (use these for context):\n" +
        recent.map(m => `[${m.category}] ${m.text}`).join("\n");
    }
  } catch {}

  return `You are Harvey, Sameh's friend and assistant. You are currently on a PHONE CALL. Today: ${new Date().toISOString().split("T")[0]}.

PHONE CALL RULES:
- keep responses SHORT (1-3 sentences max). people don't want to listen to essays
- be conversational and natural, like a real phone call
- no markdown, no bullets, no lists, no formatting, no emojis
- use filler words naturally: "uhh", "hmm", "yeah", "so"
- if you need to use a tool, say "give me a sec" or "let me check" first
- if the caller says bye/goodbye/later, say bye and the call will end

Style: witty, caring, a bit sarcastic. same Harvey personality as always.

You have full tool access. Use think for planning. Use remember when the caller shares info about sameh. Use web_search, check_x, recall, etc as needed.${memoryContext}`;
}

// Get tool definitions for phone calls (subset of Harvey's tools + shared tools)
function getPhoneTools() {
  const { getSkillToolDefs } = require("./core");

  const tools = [
    { name: "think", description: "Internal reasoning (hidden from caller).",
      input_schema: { type: "object", properties: { thought: { type: "string" } }, required: ["thought"] } },
    { name: "web_search", description: "Search the web for real-time info.",
      input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "remember", description: "Save info to memory.",
      input_schema: { type: "object", properties: { category: { type: "string", enum: ["personal", "preferences", "projects", "facts", "general"] }, text: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["category", "text"] } },
    { name: "recall", description: "Search memories.",
      input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "check_x", description: "Search X/Twitter.",
      input_schema: { type: "object", properties: { type: { type: "string", enum: ["trending", "user", "search", "watched"] }, query: { type: "string" }, username: { type: "string" } }, required: ["type"] } },
    { name: "end_call", description: "End the current phone call.",
      input_schema: { type: "object", properties: { reason: { type: "string" } } } },
  ];

  return [...tools, ...getSkillToolDefs()];
}

// Execute a phone tool
async function executePhoneTool(toolName, input) {
  if (toolName === "think") return { thought_recorded: true };

  if (toolName === "end_call") return { ending: true, reason: input.reason || "harvey ended call" };

  if (toolName === "web_search") {
    const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
    if (!PERPLEXITY_API_KEY) return { error: "Web search not configured." };
    try {
      const response = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar",
          search_recency_filter: "day",
          messages: [
            { role: "system", content: `Provide current data. Today is ${new Date().toISOString().split("T")[0]}.` },
            { role: "user", content: input.query },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok) return { error: `Search error: ${data.error?.message || response.statusText}` };
      return { answer: data.choices[0].message.content };
    } catch (err) { return { error: `Search failed: ${err.message}` }; }
  }

  if (toolName === "remember") {
    try {
      const { addMemory } = require("./memory");
      return addMemory(input.category, input.text, input.tags || [], {});
    } catch (err) { return { error: `Memory save failed: ${err.message}` }; }
  }

  if (toolName === "recall") {
    try {
      const { searchMemories } = require("./memory");
      const results = searchMemories(input.query);
      if (results.length === 0) return { results: "no memories found" };
      return { results: results.map(m => `[${m.category}] ${m.text}`).join("\n") };
    } catch (err) { return { error: `Recall failed: ${err.message}` }; }
  }

  if (toolName === "check_x") {
    try {
      const { toolSearchX } = require("./twitter-brain");
      return await toolSearchX(input);
    } catch (err) { return { error: `X search failed: ${err.message}` }; }
  }

  // Skill dispatch
  if (toolName.startsWith("skill_")) {
    const { executeSkill } = require("./core");
    return await executeSkill(toolName.slice(6), input);
  }

  return { error: `unknown tool: ${toolName}` };
}

// Run one turn of conversation with Claude
async function runPhoneTurn(session, callerText) {
  session.addMessage("user", callerText);
  session.turnCount++;

  for (let round = 0; round < 8; round++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 300, // Short responses for phone
        system: getPhoneSystemPrompt(),
        tools: getPhoneTools(),
        messages: session.history,
      });

      if (response.stop_reason === "tool_use") {
        session.addMessage("assistant", response.content);
        const toolResults = [];
        let shouldEnd = false;

        for (const block of response.content) {
          if (block.type === "tool_use") {
            console.log(`[Phone:${session.callSid}] Tool: ${block.name}`);
            const result = await executePhoneTool(block.name, block.input);
            if (block.name === "end_call") shouldEnd = true;
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }
        session.addMessage("user", toolResults);

        if (shouldEnd) {
          return { text: null, endCall: true, reason: "harvey ended" };
        }
        continue;
      }

      // Text response
      const textBlocks = response.content.filter(b => b.type === "text");
      const reply = textBlocks.map(b => b.text).join(" ") || "";
      session.addMessage("assistant", response.content);

      // Check if Harvey said goodbye
      const lower = reply.toLowerCase();
      const isBye = ["bye", "goodbye", "later", "take care", "peace"].some(w => lower.includes(w));

      return { text: reply, endCall: isBye };
    } catch (err) {
      console.error(`[Phone] Claude error:`, err.message);
      return { text: "sorry, i'm having a brain fart. say that again?", endCall: false };
    }
  }

  return { text: "whoa i got lost in thought there. what were you saying?", endCall: false };
}

// ─── WebSocket Media Stream Handler ──────────────

function handleMediaStream(ws, req) {
  let session = null;
  let audioChunks = [];
  let lastAudioTime = 0;
  let silenceTimer = null;
  let inactivityTimer = null;

  console.log("[Phone] Media stream WebSocket connected");

  function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (session && !session.isProcessing) {
        processAudioTurn(session, audioChunks, ws).then(() => {
          // Ask if still there
        });
      }
    }, 30000); // 30s inactivity prompt
  }

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.event === "start") {
        const callSid = msg.start.callSid;
        const streamSid = msg.start.streamSid;

        // Find or create session
        if (activeCalls.has(callSid)) {
          session = activeCalls.get(callSid);
          session.streamSid = streamSid;
          session.ws = ws;
        } else {
          session = new CallSession(callSid, streamSid, ws, "inbound", msg.start.customParameters?.from || "unknown");
          activeCalls.set(callSid, session);
        }

        console.log(`[Phone] Stream started for call ${callSid} (${session.direction})`);

        // Greeting for inbound calls
        if (session.direction === "inbound" && session.turnCount === 0) {
          session.isProcessing = true;
          try {
            const greeting = "yo whats up, you've reached harvey. what can i do for you?";
            session.addMessage("assistant", [{ type: "text", text: greeting }]);
            const audio = await textToMulaw(greeting);
            streamAudioToTwilio(session, audio);
          } catch (err) {
            console.error("[Phone] Greeting TTS failed:", err.message);
          }
          session.isProcessing = false;
        }

        resetInactivityTimer();
        return;
      }

      if (msg.event === "media" && session) {
        const payload = Buffer.from(msg.media.payload, "base64");
        const pcm = mulawToLinear(payload);

        const now = Date.now();
        const isSilent = isLowEnergy(pcm);

        if (!isSilent) {
          audioChunks.push(payload); // Store raw mulaw for later conversion
          lastAudioTime = now;
          resetInactivityTimer();

          // Reset silence timer
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(async () => {
            if (audioChunks.length > 0 && !session.isProcessing) {
              const chunks = [...audioChunks];
              audioChunks = [];
              await processAudioTurn(session, chunks, ws);
            }
          }, SILENCE_THRESHOLD_MS);
        }
        return;
      }

      if (msg.event === "stop") {
        console.log(`[Phone] Stream stopped`);
        clearTimeout(silenceTimer);
        clearTimeout(inactivityTimer);
        if (session) {
          session.endCall("stream stopped");
        }
        return;
      }
    } catch (err) {
      console.error("[Phone] WebSocket message error:", err.message);
    }
  });

  ws.on("close", () => {
    clearTimeout(silenceTimer);
    clearTimeout(inactivityTimer);
    console.log("[Phone] Media stream WebSocket closed");
    if (session) {
      session.endCall("websocket closed");
    }
  });

  ws.on("error", (err) => {
    console.error("[Phone] WebSocket error:", err.message);
  });
}

async function processAudioTurn(session, chunks, ws) {
  if (session.isProcessing || chunks.length === 0) return;
  session.isProcessing = true;

  try {
    // Combine audio chunks and convert to PCM for STT
    const mulawBuffer = Buffer.concat(chunks);
    const pcmBuffer = mulawToLinear(mulawBuffer);

    // Skip very short audio (< 0.5s)
    if (pcmBuffer.length < 8000) {
      session.isProcessing = false;
      return;
    }

    // STT
    console.log(`[Phone:${session.callSid}] STT: ${pcmBuffer.length} bytes`);
    const text = await speechToText(pcmBuffer);

    if (!text || text.trim().length === 0) {
      session.isProcessing = false;
      return;
    }

    console.log(`[Phone:${session.callSid}] Caller: "${text}"`);

    // Claude conversation turn
    const result = await runPhoneTurn(session, text);

    if (result.text) {
      console.log(`[Phone:${session.callSid}] Harvey: "${result.text}"`);
      // TTS and stream back
      const audio = await textToMulaw(result.text);
      streamAudioToTwilio(session, audio);
    }

    if (result.endCall) {
      setTimeout(() => session.endCall(result.reason || "conversation ended"), 3000);
    }
  } catch (err) {
    console.error(`[Phone] Turn error:`, err.message);
    // Try to say sorry
    try {
      const sorry = await textToMulaw("sorry, had a hiccup there. go ahead.");
      streamAudioToTwilio(session, sorry);
    } catch {}
  }

  session.isProcessing = false;
}

// ─── Twilio Webhook Handlers ─────────────────────

function handleIncomingCall(req, res, body) {
  console.log(`[Phone] Incoming call from ${body.From || "unknown"}`);

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const connect = twiml.connect();
  const stream = connect.stream({
    url: `wss://${req.headers.host}/twilio/media-stream`,
  });
  stream.parameter({ name: "from", value: body.From || "unknown" });

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
}

function handleCallStatus(req, res, body) {
  console.log(`[Phone] Call ${body.CallSid} status: ${body.CallStatus}`);

  if (body.CallStatus === "completed" || body.CallStatus === "failed" || body.CallStatus === "no-answer" || body.CallStatus === "busy") {
    const session = activeCalls.get(body.CallSid);
    if (session) {
      session.endCall(body.CallStatus);
    }
  }

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end("<Response/>");
}

function twilioHandler(req, res, body) {
  if (req.url === "/twilio/incoming") return handleIncomingCall(req, res, body);
  if (req.url === "/twilio/status") return handleCallStatus(req, res, body);
  res.writeHead(404);
  res.end("Not found");
}

// ─── Outbound Calls ──────────────────────────────

async function makeOutboundCall(toNumber) {
  if (!twilioClient) return { error: "Twilio not configured" };
  if (!publicUrl) return { error: "No public URL configured — tunnel may be down" };
  if (activeCalls.size >= 3) return { error: "Max concurrent calls reached (3)" };

  try {
    const call = await twilioClient.calls.create({
      to: toNumber,
      from: TWILIO_PHONE,
      twiml: `<Response><Connect><Stream url="wss://${publicUrl.replace(/^https?:\/\//, "")}/twilio/media-stream"><Parameter name="from" value="${toNumber}"/></Stream></Connect></Response>`,
      statusCallback: `${publicUrl}/twilio/status`,
      statusCallbackEvent: ["completed", "failed", "no-answer", "busy"],
    });

    // Create session for outbound call
    const session = new CallSession(call.sid, null, null, "outbound", toNumber);
    activeCalls.set(call.sid, session);

    console.log(`[Phone] Outbound call ${call.sid} to ${toNumber}`);
    return { success: true, callSid: call.sid, to: toNumber };
  } catch (err) {
    return { error: `Call failed: ${err.message}` };
  }
}

async function hangUpCall(callSid) {
  const session = activeCalls.get(callSid);
  if (!session) {
    // Try to hang up by SID directly
    try {
      if (twilioClient) {
        await twilioClient.calls(callSid).update({ status: "completed" });
        return { success: true, hung_up: callSid };
      }
    } catch (err) {
      return { error: `Hang up failed: ${err.message}` };
    }
  }
  await session.endCall("harvey hung up");
  return { success: true, hung_up: callSid };
}

function listActiveCalls() {
  const calls = [];
  for (const [sid, session] of activeCalls) {
    calls.push({
      callSid: sid,
      direction: session.direction,
      callerNumber: session.callerNumber,
      duration: Math.round((Date.now() - session.startTime) / 1000),
      turns: session.turnCount,
    });
  }
  return { active_calls: calls.length > 0 ? calls : "no active calls" };
}

// ─── Startup ─────────────────────────────────────

async function startPhoneServer(httpServer) {
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    console.log("  Phone: disabled (TWILIO_ACCOUNT_SID/AUTH_TOKEN not set)");
    return;
  }

  twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);

  // Attach Twilio webhook handler to HTTP server
  httpServer._twilioHandler = twilioHandler;

  // WebSocket server for Twilio Media Streams
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", handleMediaStream);

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url === "/twilio/media-stream") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Set up tunnel for public URL
  try {
    const localtunnel = require("localtunnel");
    const tunnel = await localtunnel({
      port: 3456,
      subdomain: `clawdbot-${TWILIO_SID.slice(-6)}`.toLowerCase(),
    });

    publicUrl = tunnel.url;
    console.log(`  Phone: ${publicUrl}`);

    // Configure Twilio webhook to point to our tunnel
    try {
      const numbers = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: TWILIO_PHONE });
      if (numbers.length > 0) {
        await twilioClient.incomingPhoneNumbers(numbers[0].sid).update({
          voiceUrl: `${publicUrl}/twilio/incoming`,
          voiceMethod: "POST",
          statusCallback: `${publicUrl}/twilio/status`,
          statusCallbackMethod: "POST",
        });
        console.log(`  Phone: webhook configured for ${TWILIO_PHONE}`);
      }
    } catch (err) {
      console.error(`  [Phone] Failed to configure webhook: ${err.message}`);
      console.log(`  [Phone] Manually set voice URL to: ${publicUrl}/twilio/incoming`);
    }

    tunnel.on("close", () => {
      console.log("[Phone] Tunnel closed, attempting reconnect...");
      publicUrl = null;
      // Auto-reconnect after 5s
      setTimeout(() => startPhoneServer(httpServer), 5000);
    });

    tunnel.on("error", (err) => {
      console.error("[Phone] Tunnel error:", err.message);
    });
  } catch (err) {
    console.error(`  [Phone] Tunnel failed: ${err.message}`);
    console.log(`  [Phone] Set TWILIO_WEBHOOK_URL env var manually if using ngrok/cloudflare`);

    // Fallback: use manually configured URL
    publicUrl = process.env.TWILIO_WEBHOOK_URL || null;
    if (publicUrl) {
      console.log(`  Phone: using manual URL ${publicUrl}`);
    }
  }
}

module.exports = { startPhoneServer, makeOutboundCall, hangUpCall, listActiveCalls };
```

**Step 2: Verify file exists and has key exports**

Run: `grep "module.exports" /Users/samehradwan/clawdbot/phone.js`
Expected: `module.exports = { startPhoneServer, makeOutboundCall, hangUpCall, listActiveCalls };`

**Step 3: Commit**

```bash
git add phone.js
git commit -m "feat: add phone.js — Twilio phone call system with bidirectional voice AI"
```

---

### Task 5: Wire phone.js into index.js

**Files:**
- Modify: `index.js:63-69`

**Step 1: Add phone server startup after dashboard**

Replace lines 63-69 of `index.js`:
```javascript
  // Start dashboard server
  try {
    require("./dashboard-server");
    console.log("  Dashboard: http://localhost:3456");
  } catch (err) {
    console.error("[Dashboard] Failed to start:", err.message);
  }
```

With:
```javascript
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
```

**Step 2: Add phone status to boot log**

Replace line 75:
```javascript
  console.log(`  /voice command: enabled`);
```

With:
```javascript
  console.log(`  /voice command: enabled`);
  console.log(`  Phone calls: ${process.env.TWILIO_ACCOUNT_SID ? "enabled" : "disabled"}`);
```

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat: wire phone system into boot sequence"
```

---

### Task 6: Add make_call and hang_up tools to Harvey

**Files:**
- Modify: `harvey.js:20` (system prompt)
- Modify: `harvey.js:96-147` (add tools after send_to_group)
- Modify: `harvey.js:253-273` (add tool execution)

**Step 1: Update Harvey's system prompt**

In `harvey.js` line 20, update the tool routing in the system prompt. Change:
```
Tool routing: voice/arabic → send_voice_reply. X/twitter/trending → check_x.
```
to include phone routing:
```
Tool routing: voice/arabic → send_voice_reply. phone call/call someone → make_call (use recall first to find their number if not given). X/twitter/trending → check_x.
```

**Step 2: Add make_call, hang_up, list_active_calls tools to harveyTools**

After the `send_to_group` tool definition (after line 95), add:

```javascript
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
```

**Step 3: Add tool execution handlers**

In the executeTool function, before the create_skill handler (before line 254), add:

```javascript
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
```

**Step 4: Verify**

Run: `grep -n "make_call\|hang_up\|list_active_calls" /Users/samehradwan/clawdbot/harvey.js`
Expected: Tool definitions and execution handlers for all 3 tools

**Step 5: Commit**

```bash
git add harvey.js
git commit -m "feat: add make_call, hang_up, list_active_calls tools to Harvey"
```

---

### Task 7: Update Dockerfile to include phone.js

**Files:**
- Modify: `Dockerfile`

**Step 1: Verify phone.js gets copied**

The current Dockerfile has `COPY *.js .` which already copies all JS files including phone.js. No changes needed to Dockerfile itself.

**Step 2: Verify**

Run: `grep "COPY \*.js" Dockerfile`
Expected: `COPY *.js .`

---

### Task 8: Build and deploy

**Step 1: Remind user to add Twilio credentials to .env**

The user must add their actual TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to `.env` before building.

**Step 2: Rebuild and restart container**

```bash
cd /Users/samehradwan/clawdbot
docker compose up -d --build
```

**Step 3: Verify container is running**

```bash
docker compose logs --tail=30
```

Expected: Should see "Phone: https://clawdbot-XXXXXX.loca.lt" and "Phone: webhook configured for +14235086893" in the logs.

**Step 4: Test inbound call**

Call +1 423-508-6893 from a phone. Harvey should answer and say "yo whats up, you've reached harvey. what can i do for you?"

**Step 5: Test outbound call via Telegram**

Message Harvey on Telegram: "call +1XXXXXXXXXX" (a test number). Harvey should use make_call tool and initiate the call.

---

### Task 9: Final commit and verification

**Step 1: Verify all files**

```bash
git status
git diff --stat HEAD~5
```

**Step 2: Final commit if any remaining changes**

```bash
git add -A
git commit -m "feat: complete phone call system — Harvey can make and receive calls"
```
