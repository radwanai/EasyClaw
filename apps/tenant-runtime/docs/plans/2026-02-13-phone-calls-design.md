# Harvey Phone Calls — Design Document

**Date:** 2026-02-13
**Status:** Approved

## Summary

Give Harvey the ability to make and receive real phone calls via Twilio. Callers have a live two-way AI voice conversation with Harvey, who retains full tool access (memory, web search, X, skills) during calls. Uses ElevenLabs for STT/TTS to keep Harvey's existing Egyptian Arabic voice identity.

## Architecture

```
OUTBOUND (Harvey dials someone):
  Sameh on Telegram → "call my mom" → Harvey `make_call` tool
  → Twilio REST API dials number → person picks up
  → Twilio WebSocket Media Stream connects to Harvey
  → Bidirectional audio: Caller ↔ Twilio ↔ WebSocket ↔ Harvey

INBOUND (Someone calls Harvey):
  Phone rings +1 423-508-6893 → Twilio POST /twilio/incoming
  → TwiML response connects to WebSocket Media Stream
  → Same bidirectional audio loop

AUDIO LOOP (per turn):
  1. Twilio streams mulaw 8kHz audio via WebSocket
  2. Buffer audio until silence detected (~1.5s threshold)
  3. Convert buffer → ElevenLabs STT (Scribe) → text
  4. Feed text to Claude with Harvey's system prompt + tools
  5. Execute any tool calls (memory, search, etc.) — loop until text response
  6. Send text response → ElevenLabs TTS → audio
  7. Stream TTS audio back through WebSocket → Twilio → caller
```

## New Components

### phone.js (~250-300 lines)

New file handling all Twilio + WebSocket + call logic:

- `startPhoneServer(httpServer)` — attaches Twilio routes and WebSocket handler to existing HTTP server
- `handleIncomingCall(req, res)` — returns TwiML connecting to media stream
- `handleMediaStream(ws)` — manages bidirectional audio loop per call
- `makeOutboundCall(toNumber)` — Twilio REST API to initiate calls
- `CallSession` class — per-call state: audio buffer, conversation history, call SID, start time
- Silence detection: ~1.5s of silence = end of caller turn
- Integrates with voice.js for ElevenLabs STT/TTS
- On call end: optionally sends summary to Sameh on Telegram

### Modified: dashboard-server.js

- Upgrade to support WebSocket (via `ws` npm package) for Twilio media streams
- Add routes: POST /twilio/incoming, POST /twilio/status
- WebSocket upgrade handler for /twilio/media-stream
- Existing dashboard routes unchanged

### Modified: harvey.js

- Add `make_call` tool: dials a phone number, Harvey talks to the person
- Add `hang_up` tool: ends an active call
- Update system prompt: phone call routing ("call someone → make_call")

### Modified: docker-compose.yml

- No port changes needed (3456 already exposed)

### Modified: index.js

- Call `startPhoneServer(server)` after dashboard server starts
- Set up localtunnel for public URL, configure Twilio webhook on boot

## New Dependencies

- `twilio` — Twilio Node SDK (REST API + TwiML generation)
- `ws` — WebSocket server for media streams
- `localtunnel` — public tunnel so Twilio webhooks can reach Docker container

## New Environment Variables

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+14235086893
```

## Call Conversation Design

- Each call gets its own conversation history (separate from Telegram)
- Harvey's phone system prompt adds: "you're on a phone call right now. keep responses short and conversational. no markdown, no lists, no formatting."
- Full tool access during calls: memory, web search, X, skills, etc.
- During tool execution, brief hold tone plays so caller knows Harvey is working
- Phone number lookup: Harvey can take a number directly OR recall from memory

## Silence Detection

- Buffer incoming audio chunks from Twilio WebSocket
- Track energy level of audio frames
- After ~1.5s of low-energy audio, consider the turn complete
- Configurable via SILENCE_THRESHOLD_MS env var
- Edge case: if caller is silent for >30s, Harvey prompts "you still there?"

## Security

- Inbound calls: Harvey answers anyone who calls the Twilio number
- Outbound calls: only triggered via Harvey's Telegram tools (auth-gated)
- Call duration limit: 30 minutes max per call
- Rate limit: max 3 concurrent calls

## Tunnel Strategy

- localtunnel creates a public URL on boot (e.g., https://xyz.loca.lt)
- On startup, phone.js uses Twilio API to update the phone number's webhook URL
- If tunnel drops, auto-reconnect with same subdomain
- Fallback: user can manually set TWILIO_WEBHOOK_URL env var for ngrok/cloudflare tunnel
