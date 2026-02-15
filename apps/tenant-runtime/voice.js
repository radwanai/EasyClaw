// voice.js — ElevenLabs TTS + STT for Telegram Voice Messages
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "LXrTqFIgiubkrMkwvOUr"; // Masry — Egyptian Arabic
const MODEL_ID = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const DATA_DIR = process.env.DATA_DIR || "./data";
const VOICE_DIR = path.join(DATA_DIR, "voice");

// Ensure voice cache dir exists
if (!fs.existsSync(VOICE_DIR)) fs.mkdirSync(VOICE_DIR, { recursive: true });

/**
 * Convert text to speech using ElevenLabs and return path to OGG Opus file.
 * Telegram requires OGG Opus for voice notes (inline playable messages).
 *
 * @param {string} text - Text to speak
 * @param {object} [opts] - Options
 * @param {string} [opts.voiceId] - Override voice ID
 * @returns {Promise<{path: string, format: string}>} Path to audio file
 */
async function textToVoice(text, opts = {}) {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");

  const voiceId = opts.voiceId || VOICE_ID;
  const ts = Date.now();
  const mp3Path = path.join(VOICE_DIR, `tts_${ts}.mp3`);
  const oggPath = path.join(VOICE_DIR, `tts_${ts}.ogg`);

  // Call ElevenLabs TTS API
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
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
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs error ${response.status}: ${err}`);
  }

  // Save MP3
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(mp3Path, buffer);

  // Convert MP3 → OGG Opus (required for Telegram voice notes)
  try {
    execFileSync("ffmpeg", ["-y", "-i", mp3Path, "-acodec", "libopus", "-b:a", "64k", "-vbr", "on", oggPath], {
      stdio: "pipe",
    });
  } catch (err) {
    // If ffmpeg fails, fall back to sending MP3 as audio (not voice note)
    console.error("[Voice] ffmpeg conversion failed, using MP3:", err.message);
    return { path: mp3Path, format: "mp3" };
  }

  // Clean up MP3
  try { fs.unlinkSync(mp3Path); } catch {}

  return { path: oggPath, format: "ogg" };
}

/**
 * Clean up old voice files (older than 5 minutes)
 */
function cleanupVoiceFiles() {
  if (!fs.existsSync(VOICE_DIR)) return;
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const file of fs.readdirSync(VOICE_DIR)) {
    const filePath = path.join(VOICE_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(filePath);
    } catch {}
  }
}

// Clean up voice files every 10 minutes
setInterval(cleanupVoiceFiles, 10 * 60 * 1000);

/**
 * Transcribe a voice file using ElevenLabs Scribe v2.
 * Supports OGG, MP3, WAV, etc. Great Arabic support.
 *
 * @param {string} filePath - Path to audio file
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeVoice(filePath) {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const blob = new Blob([fileBuffer], { type: "audio/ogg" });

  const formData = new FormData();
  formData.append("file", blob, fileName);
  formData.append("model_id", "scribe_v1");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs STT error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.text || "";
}

module.exports = { textToVoice, transcribeVoice, cleanupVoiceFiles };
