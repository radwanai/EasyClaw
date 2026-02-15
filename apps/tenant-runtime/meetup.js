// meetup.js — Agent-to-Agent Real-Time Conversations (with user participation)
const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || "claude-sonnet-4-5-20250929";

// ─── Active Meetup State ──────────────────────────────
// Tracks active meetups per chat so user messages can be captured
// Key: chatId, Value: { userMessages: [] }
const activeMeetups = new Map();

/**
 * Check if a meetup is active in a chat.
 * Called by core.js text handler to intercept user messages.
 */
function isMeetupActive(chatId) {
  return activeMeetups.has(chatId);
}

/**
 * Push a user message into the active meetup's queue.
 * Called by core.js when a user sends a message during an active meetup.
 */
function pushUserMessage(chatId, fromName, text) {
  const state = activeMeetups.get(chatId);
  if (state) {
    state.userMessages.push({ from: fromName, text });
    console.log(`[Meetup] User message captured: "${text.slice(0, 60)}"`);
  }
}

/**
 * Drain all pending user messages from the queue.
 * Returns array of { from, text } and clears the queue.
 */
function drainUserMessages(chatId) {
  const state = activeMeetups.get(chatId);
  if (!state) return [];
  const msgs = [...state.userMessages];
  state.userMessages = [];
  return msgs;
}

// ─── Delay between agent turns (seconds) ─────────────
const PAUSE_BETWEEN_TURNS = 20; // seconds — gives user time to type

/**
 * Run a live meetup conversation — each agent sends their own messages
 * in real-time. User can jump in during pauses and agents will respond.
 *
 * @param {object} opts
 * @param {string} opts.chatId - Telegram chat ID
 * @param {object} opts.bots - { Harvey: telegramInstance, Laura: telegramInstance }
 * @param {string} opts.topic - Conversation topic
 * @param {number} [opts.rounds] - Number of rounds (default: 4)
 */
async function runMeetup(opts = {}) {
  const {
    chatId,
    bots,
    topic,
    rounds = 4,
  } = opts;

  const agent1Name = "Harvey";
  const agent2Name = "Laura";

  console.log(`[Meetup] Starting: "${topic}" (${rounds} rounds, ${PAUSE_BETWEEN_TURNS}s pauses)`);

  const harveyBot = bots[agent1Name];
  const lauraBot = bots[agent2Name];

  if (!harveyBot || !lauraBot) {
    console.error("[Meetup] Missing bot references — need both Harvey and Laura");
    if (harveyBot) await harveyBot.sendMessage(chatId, "Meetup failed — Laura isn't available right now.");
    return;
  }

  // Register active meetup so core.js captures user messages
  activeMeetups.set(chatId, { userMessages: [] });

  // Send the topic header
  await harveyBot.sendMessage(chatId, `☕ *Agent Meetup*\n_Topic: "${topic}"_\n\n💬 Jump in anytime — we'll respond to you!`, { parse_mode: "Markdown" });

  const agent1Prompt = `You are Harvey, a personal AI assistant. You're in a casual group chat with Laura (SHR Company's work assistant) and Sameh (your boss). Be yourself — witty, opinionated, concise. Keep responses to 2-3 sentences max. Have personality. Don't prefix your messages with your name. If Sameh says something, make sure to engage with his message — he's part of the conversation.`;

  const agent2Prompt = `You are Laura, an AI work assistant for SHR Company. You're in a casual group chat with Harvey (Sameh's personal assistant) and Sameh (your boss). Be yourself — sharp, practical, with a dry sense of humor. Keep responses to 2-3 sentences max. Have personality. Don't prefix your messages with your name. If Sameh says something, make sure to engage with his message — he's part of the conversation.`;

  // Full conversation log (agents + user messages interleaved)
  const conversation = [];
  let lastMessage = `Topic for today: ${topic}`;

  try {
    for (let round = 0; round < rounds; round++) {
      // ─── Check for user messages before Harvey speaks ────
      const userMsgsBefore = drainUserMessages(chatId);
      for (const um of userMsgsBefore) {
        conversation.push({ speaker: "Sameh", text: um.text });
        lastMessage = `[Sameh]: ${um.text}`;
      }

      // ─── Harvey speaks ───────────────────
      await generateAndSend(agent1Name, agent1Prompt, harveyBot, chatId, conversation, lastMessage);

      // Wait — user can type during this pause
      await sleep(PAUSE_BETWEEN_TURNS * 1000);

      // ─── Check for user messages before Laura speaks ────
      const userMsgsMiddle = drainUserMessages(chatId);
      for (const um of userMsgsMiddle) {
        conversation.push({ speaker: "Sameh", text: um.text });
        lastMessage = `[Sameh]: ${um.text}`;
      }

      // ─── Laura speaks ────────────────────
      await generateAndSend(agent2Name, agent2Prompt, lauraBot, chatId, conversation, lastMessage);

      // Wait between rounds
      if (round < rounds - 1) await sleep(PAUSE_BETWEEN_TURNS * 1000);
    }

    // Check one final time for any user messages
    const finalMsgs = drainUserMessages(chatId);
    if (finalMsgs.length > 0) {
      // Let Harvey have the last word responding to the user
      for (const um of finalMsgs) {
        conversation.push({ speaker: "Sameh", text: um.text });
        lastMessage = `[Sameh]: ${um.text}`;
      }
      await generateAndSend(agent1Name, agent1Prompt, harveyBot, chatId, conversation, lastMessage);
    }

    // Closing message
    await harveyBot.sendMessage(chatId, "☕ _Meetup over! Back to work._", { parse_mode: "Markdown" });
    console.log(`[Meetup] Done — ${conversation.length} messages exchanged`);
  } finally {
    // Always clean up the active meetup state
    activeMeetups.delete(chatId);
  }
}

/**
 * Generate a response from an agent and send it to the chat.
 * Updates the shared conversation array.
 */
async function generateAndSend(agentName, systemPrompt, telegramBot, chatId, conversation, lastMessage) {
  // Build message history from this agent's perspective
  const messages = conversation.map((c) => ({
    role: c.speaker === agentName ? "assistant" : "user",
    content: c.speaker === "Sameh" ? `[Sameh]: ${c.text}` : c.text,
  }));
  // Add the last message if it's not already in conversation
  if (messages.length === 0 || messages[messages.length - 1].content !== lastMessage) {
    messages.push({ role: "user", content: lastMessage });
  }

  try {
    await telegramBot.sendChatAction(chatId, "typing");

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: systemPrompt,
      messages,
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("") || "...";
    conversation.push({ speaker: agentName, text });

    await telegramBot.sendMessage(chatId, text);
    console.log(`[Meetup] ${agentName}: ${text.slice(0, 80)}...`);
  } catch (err) {
    console.error(`[Meetup] ${agentName} error:`, err.message);
    conversation.push({ speaker: agentName, text: "(couldn't respond)" });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { runMeetup, isMeetupActive, pushUserMessage };
