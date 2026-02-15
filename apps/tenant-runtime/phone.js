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
const MODEL_ID = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
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
    this.isSpeaking = false;    // true while Harvey's audio is playing (ignore incoming audio)
    this._speakingFallback = null;

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

// Convert mulaw 8kHz (Twilio format) to linear PCM for STT
function mulawToLinear(mulawBuffer) {
  const MULAW_BIAS = 33;
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
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);   // PCM format
  header.writeUInt16LE(1, 22);   // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);   // block align
  header.writeUInt16LE(16, 34);  // bits per sample
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
  // output_format MUST be a query parameter, not in the JSON body
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=ulaw_8000`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.85,
        style: 0.4,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`TTS error ${response.status}: ${err}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

// Send mulaw audio back to Twilio via WebSocket, with mark event at end
function streamAudioToTwilio(session, mulawBuffer) {
  if (!session.ws || session.ws.readyState !== 1) return;

  session.isSpeaking = true;

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

  // Send a mark event so Twilio tells us when audio is done playing
  try {
    session.ws.send(JSON.stringify({
      event: "mark",
      streamSid: session.streamSid,
      mark: { name: "speech_done" },
    }));
  } catch {}

  // Fallback: estimate duration from buffer size and clear after that
  // mulaw 8kHz = 8000 bytes/sec
  const estimatedMs = Math.ceil((mulawBuffer.length / 8000) * 1000) + 500;
  clearTimeout(session._speakingFallback);
  session._speakingFallback = setTimeout(() => {
    session.isSpeaking = false;
  }, estimatedMs);
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

// Get tool definitions for phone calls
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
        max_tokens: 300,
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
      const isBye = ["bye", "goodbye", "later", "take care", "peace out"].some(w => lower.includes(w));

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
  let silenceTimer = null;
  let inactivityTimer = null;

  console.log("[Phone] Media stream WebSocket connected");

  function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
      if (session && !session.isProcessing) {
        // Prompt the caller after 30s of silence
        session.isProcessing = true;
        try {
          const prompt = "hey, you still there?";
          session.addMessage("assistant", [{ type: "text", text: prompt }]);
          const audio = await textToMulaw(prompt);
          streamAudioToTwilio(session, audio);
        } catch {}
        session.isProcessing = false;
      }
    }, 30000);
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

        // Greeting (small delay to let stream stabilize)
        if (session.turnCount === 0) {
          session.isProcessing = true;
          const greeting = session.direction === "inbound"
            ? "yo whats up, you've reached harvey. what can i do for you?"
            : "hey, its harvey. whats good?";
          setTimeout(async () => {
            try {
              session.addMessage("assistant", [{ type: "text", text: greeting }]);
              console.log(`[Phone:${session.callSid}] Playing greeting (${session.direction})...`);
              const audio = await textToMulaw(greeting);
              streamAudioToTwilio(session, audio);
              console.log(`[Phone:${session.callSid}] Greeting sent (${audio.length} bytes)`);
            } catch (err) {
              console.error("[Phone] Greeting TTS failed:", err.message);
            }
            session.isProcessing = false;
          }, 500);
        }

        resetInactivityTimer();
        return;
      }

      // Mark event: Twilio tells us audio finished playing
      if (msg.event === "mark" && session) {
        if (msg.mark && msg.mark.name === "speech_done") {
          session.isSpeaking = false;
          clearTimeout(session._speakingFallback);
          // Clear any audio that accumulated while we were speaking (echo)
          audioChunks = [];
        }
        return;
      }

      if (msg.event === "media" && session) {
        // Skip incoming audio while Harvey is speaking (prevents echo feedback)
        if (session.isSpeaking || session.isProcessing) return;

        const payload = Buffer.from(msg.media.payload, "base64");
        const pcm = mulawToLinear(payload);
        const isSilent = isLowEnergy(pcm);

        if (!isSilent) {
          audioChunks.push(payload); // Store raw mulaw
          resetInactivityTimer();

          // Reset silence timer — fires when caller stops talking
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(async () => {
            if (audioChunks.length > 0 && !session.isProcessing) {
              const chunks = [...audioChunks];
              audioChunks = [];
              await processAudioTurn(session, chunks);
            }
          }, SILENCE_THRESHOLD_MS);
        }
        return;
      }

      if (msg.event === "stop") {
        console.log(`[Phone] Stream stopped`);
        clearTimeout(silenceTimer);
        clearTimeout(inactivityTimer);
        if (session) session.endCall("stream stopped");
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
    if (session) session.endCall("websocket closed");
  });

  ws.on("error", (err) => {
    console.error("[Phone] WebSocket error:", err.message);
  });
}

async function processAudioTurn(session, chunks) {
  if (session.isProcessing || chunks.length === 0) return;
  session.isProcessing = true;

  try {
    // Combine audio chunks and convert to PCM for STT
    const mulawBuffer = Buffer.concat(chunks);
    const pcmBuffer = mulawToLinear(mulawBuffer);

    console.log(`[Phone:${session.callSid}] Processing ${chunks.length} chunks, ${pcmBuffer.length} bytes PCM (${(pcmBuffer.length / 16000).toFixed(1)}s)`);

    // Skip very short audio (< 0.25s at 8kHz 16-bit = 4000 bytes)
    if (pcmBuffer.length < 4000) {
      console.log(`[Phone:${session.callSid}] Audio too short, skipping`);
      session.isProcessing = false;
      return;
    }

    // Speech-to-text
    console.log(`[Phone:${session.callSid}] STT: ${pcmBuffer.length} bytes`);
    const text = await speechToText(pcmBuffer);

    if (!text || text.trim().length === 0) {
      session.isProcessing = false;
      return;
    }

    console.log(`[Phone:${session.callSid}] Caller: "${text}"`);

    // Run Claude conversation turn
    const result = await runPhoneTurn(session, text);

    if (result.text) {
      console.log(`[Phone:${session.callSid}] Harvey: "${result.text}"`);
      const audio = await textToMulaw(result.text);
      streamAudioToTwilio(session, audio);
    }

    if (result.endCall) {
      // Small delay so farewell audio finishes playing
      setTimeout(() => session.endCall(result.reason || "conversation ended"), 3000);
    }
  } catch (err) {
    console.error(`[Phone] Turn error:`, err.message);
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

  if (["completed", "failed", "no-answer", "busy", "canceled"].includes(body.CallStatus)) {
    const session = activeCalls.get(body.CallSid);
    if (session) session.endCall(body.CallStatus);
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
    const wsHost = publicUrl.replace(/^https?:\/\//, "");
    const call = await twilioClient.calls.create({
      to: toNumber,
      from: TWILIO_PHONE,
      twiml: `<Response><Connect><Stream url="wss://${wsHost}/twilio/media-stream"><Parameter name="from" value="${toNumber}"/></Stream></Connect></Response>`,
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
  if (session) {
    await session.endCall("harvey hung up");
    return { success: true, hung_up: callSid };
  }
  // Try to hang up by SID directly
  try {
    if (twilioClient) {
      await twilioClient.calls(callSid).update({ status: "completed" });
      return { success: true, hung_up: callSid };
    }
  } catch (err) {
    return { error: `Hang up failed: ${err.message}` };
  }
  return { error: "Call not found" };
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
    console.log("  Phone: disabled (TWILIO credentials not set)");
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

  // Set up tunnel for public URL using cloudflared (much more reliable than localtunnel)
  try {
    const { execSync, spawn } = require("child_process");

    // Check if manual URL is set
    if (process.env.TWILIO_WEBHOOK_URL) {
      publicUrl = process.env.TWILIO_WEBHOOK_URL;
      console.log(`  Phone: using manual URL ${publicUrl}`);
    } else {
      // Start cloudflared quick tunnel
      const cf = spawn("cloudflared", ["tunnel", "--url", "http://localhost:3456", "--no-autoupdate"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // cloudflared prints the URL to stderr
      const tunnelUrl = await new Promise((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(() => reject(new Error("cloudflared timeout")), 15000);

        cf.stderr.on("data", (data) => {
          output += data.toString();
          // Look for the tunnel URL in output
          const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
          if (match) {
            clearTimeout(timeout);
            resolve(match[0]);
          }
        });

        cf.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        cf.on("exit", (code) => {
          if (code !== 0 && !output.includes("trycloudflare.com")) {
            clearTimeout(timeout);
            reject(new Error(`cloudflared exited with code ${code}`));
          }
        });
      });

      publicUrl = tunnelUrl;
      console.log(`  Phone: ${publicUrl}`);

      // Auto-restart cloudflared if it dies
      cf.on("exit", (code) => {
        console.log(`[Phone] cloudflared exited (code ${code}), restarting in 5s...`);
        publicUrl = null;
        setTimeout(() => startPhoneServer(httpServer), 5000);
      });
    }

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
      } else {
        console.log(`  [Phone] Phone number ${TWILIO_PHONE} not found in account`);
      }
    } catch (err) {
      console.error(`  [Phone] Failed to configure webhook: ${err.message}`);
      console.log(`  [Phone] Manually set voice URL to: ${publicUrl}/twilio/incoming`);
    }
  } catch (err) {
    console.error(`  [Phone] Tunnel failed: ${err.message}`);
    publicUrl = process.env.TWILIO_WEBHOOK_URL || null;
    if (publicUrl) {
      console.log(`  Phone: using manual URL ${publicUrl}`);
    } else {
      console.log(`  [Phone] Set TWILIO_WEBHOOK_URL env var for manual tunnel`);
    }
  }
}

module.exports = { startPhoneServer, makeOutboundCall, hangUpCall, listActiveCalls };
