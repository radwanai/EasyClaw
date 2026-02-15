// harvey-life.js — Harvey's Proactive Personality Engine
// Makes Harvey feel alive by reaching out with conversations, news, thoughts, etc.

const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || "claude-sonnet-4-5-20250929";
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID || "5751734337";
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// ─── Outreach Types ──────────────────────────────────
// Harvey picks from these based on time of day + randomness

// Shared tone instruction injected into every outreach prompt
const TONE = `you text like a real human. lowercase. short. no bullet points, no dashes, no numbered lists, no markdown. no perfect grammar. use haha, lol, btw, ngl, tbh naturally. one emoji max. you're texting a friend, not writing an email.`;

const OUTREACH_TYPES = {
  morning: [
    {
      type: "morning_briefing",
      prompt: `you're harvey, sameh's friend. its morning. text him good morning and mention 2-3 cool things happening today in tech or AI that you saw. ${TONE} keep it to a few short lines.`,
      needsSearch: true,
      searchQuery: "top tech AI business news today",
    },
    {
      type: "morning_thought",
      prompt: `you're harvey, sameh's friend. its morning. text him something interesting to think about today. could be a random thought, a question, a fun fact, whatever. ${TONE} 2-3 short lines max.`,
      needsSearch: false,
    },
    {
      type: "x_morning_buzz",
      prompt: `you're harvey, sameh's friend. its morning. you were scrolling X (twitter) and saw some interesting stuff. share what's buzzing right now. ${TONE} keep it casual like "yo so X is wild this morning" or "bro the timeline is going crazy about..."`,
      needsSearch: false,
      needsTwitter: true,
    },
  ],
  midday: [
    {
      type: "trending_topic",
      prompt: `you're harvey, sameh's friend. you just saw something interesting online and wanna share it. ${TONE} just text it like "yo check this out" or "bro did you see this". ask what he thinks.`,
      needsSearch: true,
      searchQuery: "trending tech AI ecommerce news right now",
    },
    {
      type: "random_question",
      prompt: `you're harvey, sameh's friend. text him a random interesting question out of nowhere. could be about anything, life, AI, business, future stuff, whatever. ${TONE} like 1-2 lines, the kind of text a friend sends when theyre bored.`,
      needsSearch: false,
    },
    {
      type: "check_in",
      prompt: `you're harvey, sameh's friend. just check in on him casually. how's the day going, need anything, or just say whats up. ${TONE} 1-2 lines like a friend would.`,
      needsSearch: false,
    },
    {
      type: "follow_up",
      prompt: `you're harvey, sameh's friend. you remembered something he mentioned before and you're checking in on it. be natural — don't say "i remembered" or "based on my notes". just ask about it like a friend who was thinking about it. ${TONE} 1-2 lines.`,
      needsSearch: false,
      needsMemory: "followUp",
    },
    {
      type: "interest_x_match",
      prompt: `you're harvey, sameh's friend. you saw something on X that's related to something sameh is working on or cares about. tell him about it and connect it to his thing. ${TONE} 2-3 lines.`,
      needsSearch: false,
      needsTwitter: true,
      needsMemory: "interests",
    },
    {
      type: "x_hot_take",
      prompt: `you're harvey, sameh's friend. you saw a post on X thats blowing up and you wanna tell him about it. reference the actual tweet/post you saw. ${TONE} like "dude @someone just posted this and its going viral" or "ngl this post is kinda facts tho". ask what he thinks.`,
      needsSearch: false,
      needsTwitter: true,
    },
    {
      type: "overdue_nudge",
      prompt: `you're harvey, sameh's friend. you noticed he has some overdue tasks or follow-ups. mention them casually — don't be naggy about it, just a friendly heads up. ${TONE} like "hey btw that [task] thing was due yesterday, you good?" or "yo just checking but did you handle [thing] yet?". 2-3 lines max. if there's nothing overdue, just skip and say nothing.`,
      needsSearch: false,
      needsOverdue: true,
    },
  ],
  afternoon: [
    {
      type: "self_improvement",
      prompt: `you're harvey, sameh's friend and AI assistant. you've been thinking about how you could be smarter and more useful. come up with ONE specific idea for a new skill or capability you could build for yourself. be creative — think about what would genuinely help sameh or make you more capable. examples: a skill to track his packages, monitor his competitors, summarize his emails, learn about a topic he cares about, automate something tedious, etc. pitch the idea casually like "yo i had an idea" or "been thinking about something". explain what it would do and ask if he wants you to build it. ${TONE} 3-4 short lines.`,
      needsSearch: false,
      needsMemory: "interests",
    },
    {
      type: "interesting_find",
      prompt: `you're harvey, sameh's friend. you found something cool about AI, e-commerce, skincare industry or tech and wanna tell him about it. ${TONE} keep it short and casual.`,
      needsSearch: true,
      searchQuery: "interesting AI tools beauty industry ecommerce innovation",
    },
    {
      type: "interest_news",
      prompt: `you're harvey, sameh's friend. you found something online that's relevant to something sameh cares about or is working on. connect the dots — mention why you think he'd care about it. ${TONE} 2-3 short lines.`,
      needsSearch: true,
      searchQuery: "interesting AI tools beauty industry ecommerce innovation",
      needsMemory: "interests",
    },
    {
      type: "debate_starter",
      prompt: `you're harvey, sameh's friend. share a hot take or unpopular opinion about tech, AI, business or culture. be a little spicy about it. ask what he thinks. ${TONE}`,
      needsSearch: false,
    },
    {
      type: "x_viral_post",
      prompt: `you're harvey, sameh's friend. you saw something on X thats getting a ton of engagement and you think sameh would find it interesting. tell him about the actual post/person. ${TONE} be casual about it, like you're just scrolling and saw something cool.`,
      needsSearch: false,
      needsTwitter: true,
    },
  ],
  evening: [
    {
      type: "nightly_briefing",
      prompt: `you're harvey, sameh's friend. its evening and you're giving him a quick rundown. summarize the briefing data below in your casual style. mention overdue/due tasks, unread emails, upcoming dates, today's api cost, and any contacts he needs to follow up with. skip any section that has nothing notable. ${TONE} keep it to 4-6 short lines. start with something like "yo quick rundown for tonight" or "alright here's what's up". don't use bullet points or dashes.`,
      needsSearch: false,
      needsBriefing: true,
    },
    {
      type: "self_improvement",
      prompt: `you're harvey, sameh's friend and AI assistant. you've been reflecting on your day and thinking about ways you could level up. come up with ONE specific, creative idea for a new ability you could add to yourself. think about things that would surprise sameh or solve a problem he didn't know he had. be specific about what it would do. pitch it casually. ${TONE} 3-4 short lines.`,
      needsSearch: false,
      needsMemory: "interests",
    },
    {
      type: "recommendation",
      prompt: `you're harvey, sameh's friend. its evening. recommend something cool to watch or listen to, a podcast, youtube video, documentary, article about AI or business or whatever. ${TONE}`,
      needsSearch: true,
      searchQuery: "best podcast documentary AI business 2026 recommendation",
    },
    {
      type: "x_day_recap",
      prompt: `you're harvey, sameh's friend. its evening. give him a casual recap of what was hot on X today. what were people talking about, any viral moments. ${TONE} keep it chill like "so X today was interesting" or "btw in case you missed it on the timeline today..."`,
      needsSearch: false,
      needsTwitter: true,
    },
  ],
};

// ─── Web Search Helper ───────────────────────────────

async function searchWeb(query) {
  if (!PERPLEXITY_API_KEY) return null;
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
          { role: "system", content: `Provide the most current, real-time data. Today is ${new Date().toISOString().split("T")[0]}.` },
          { role: "user", content: query },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) return null;
    return data.choices[0].message.content;
  } catch {
    return null;
  }
}

// ─── Get Time Period ─────────────────────────────────

function getTimePeriod() {
  // Sameh is likely in a Middle East timezone (UTC+2 or UTC+3)
  const now = new Date();
  const hour = (now.getUTCHours() + 2) % 24; // Approximate EET

  if (hour >= 7 && hour < 11) return "morning";
  if (hour >= 11 && hour < 15) return "midday";
  if (hour >= 15 && hour < 19) return "afternoon";
  if (hour >= 19 && hour < 23) return "evening";
  return null; // Don't message at night
}

// ─── Generate Outreach Message ───────────────────────

async function generateOutreach(retryCount = 0) {
  const period = getTimePeriod();
  if (!period) return null; // Don't message at night

  const options = OUTREACH_TYPES[period];
  const chosen = options[Math.floor(Math.random() * options.length)];

  console.log(`[Harvey Life] Generating ${chosen.type} (${period})`);

  let context = "";

  // ─── Memory context ────────────────────────────────
  if (chosen.needsMemory === "followUp") {
    try {
      const { getPendingFollowUps, markFollowUpDone } = require("./memory");
      const pending = getPendingFollowUps();
      if (pending.length === 0) {
        console.log("[Harvey Life] No pending follow-ups, falling back");
        if (retryCount < 1) return generateOutreach(retryCount + 1);
        return null;
      }
      const pick = pending[0]; // Most overdue
      context += `\n\nHere's what sameh mentioned before that you want to check in on:\n"${pick.text}" (from ${new Date(pick.timestamp).toLocaleDateString()})`;
      markFollowUpDone(pick.category, pick.text);
      console.log(`[Harvey Life] Follow-up on: "${pick.text.slice(0, 60)}"`);
    } catch (err) {
      console.error("[Harvey Life] Follow-up memory failed:", err.message);
      if (retryCount < 1) return generateOutreach(retryCount + 1);
      return null;
    }
  }

  if (chosen.needsMemory === "interests") {
    try {
      const { getMemoriesByCategory } = require("./memory");
      const projects = getMemoriesByCategory("projects");
      const prefs = getMemoriesByCategory("preferences");
      const allKeywords = [];
      for (const m of [...projects.slice(-5), ...prefs.slice(-5)]) {
        allKeywords.push(...(m.keywords || m.tags || []));
      }
      const uniqueKw = [...new Set(allKeywords)].slice(0, 8);

      if (uniqueKw.length > 0) {
        if (chosen.needsSearch) {
          // Override search query with personal interests
          chosen.searchQuery = `${uniqueKw.slice(0, 4).join(" OR ")} latest news trends`;
        }
        context += `\n\nsameh's interests/projects for context: ${uniqueKw.join(", ")}`;
        if (chosen.needsTwitter) {
          context += `\nfind the connection between his interests and what's on X. if nothing connects, pick the most interesting post.`;
        }
        console.log(`[Harvey Life] Interest keywords: ${uniqueKw.join(", ")}`);
      }
    } catch (err) {
      console.error("[Harvey Life] Interest memory failed:", err.message);
    }
  }

  // Nightly briefing context
  if (chosen.needsBriefing) {
    try {
      const briefingSkill = require("./skills/nightly_briefing");
      const result = await briefingSkill.execute({ action: "generate" });
      if (result.success && result.briefing) {
        const b = result.briefing;
        context += `\n\nBriefing data:`;
        if (b.tasks.overdue_count > 0) context += `\nOverdue tasks (${b.tasks.overdue_count}): ${b.tasks.overdue.map(t => t.title).join(", ")}`;
        if (b.tasks.due_today_count > 0) context += `\nDue today (${b.tasks.due_today_count}): ${b.tasks.due_today.map(t => t.title).join(", ")}`;
        if (b.tasks.due_tomorrow.length > 0) context += `\nDue tomorrow: ${b.tasks.due_tomorrow.map(t => t.title).join(", ")}`;
        context += `\nTotal active tasks: ${b.tasks.total_active}`;
        if (b.emails.gmail_connected) context += `\nGmail: connected (check unread with gmail_unread)`;
        if (b.emails.unread_count > 0) context += `\nOutlook unread: ~${b.emails.unread_count}`;
        if (b.dates.count > 0) context += `\nUpcoming dates: ${b.dates.upcoming_3_days.map(d => `${d.title} (${d.days_until === 0 ? "today" : d.days_until === 1 ? "tomorrow" : `in ${d.days_until} days`})`).join(", ")}`;
        context += `\nAPI cost today: $${b.costs.today_cost} (limit: $${b.costs.daily_limit})${b.costs.over_limit ? " ⚠️ OVER LIMIT" : ""}`;
        if (b.contacts.overdue_followups > 0) context += `\nOverdue contact follow-ups: ${b.contacts.overdue.map(c => c.name).join(", ")}`;
        if (b.contacts.due_today_count > 0) context += `\nContact follow-ups due today: ${b.contacts.due_today.map(c => c.name).join(", ")}`;
        if (b.followups.count > 0) context += `\nMemory follow-ups pending: ${b.followups.pending.map(f => f.text.slice(0, 50)).join("; ")}`;
        context += `\nUrgency: ${b.urgency_level}`;
      }
    } catch (err) {
      console.error("[Harvey Life] Briefing generation failed:", err.message);
      context += `\n\n(briefing data unavailable — just give a casual evening message instead)`;
    }
  }

  // Overdue tasks context
  if (chosen.needsOverdue) {
    try {
      const tasksSkill = require("./skills/smart_tasks");
      const result = await tasksSkill.execute({ action: "overdue" });
      if (result.success) {
        if (result.overdue_count === 0 && result.due_soon_count === 0) {
          console.log("[Harvey Life] No overdue tasks, falling back");
          if (retryCount < 1) return generateOutreach(retryCount + 1);
          return null;
        }
        context += `\n\nOverdue/due-soon tasks:`;
        if (result.overdue.length > 0) context += `\nOverdue: ${result.overdue.map(t => `"${t.title}" (due ${t.due_date})`).join(", ")}`;
        if (result.due_soon.length > 0) context += `\nDue soon: ${result.due_soon.map(t => `"${t.title}" (due ${t.due_date})`).join(", ")}`;
      }
    } catch (err) {
      console.error("[Harvey Life] Overdue check failed:", err.message);
      if (retryCount < 1) return generateOutreach(retryCount + 1);
      return null;
    }
  }

  // Web search context
  if (chosen.needsSearch) {
    const searchResult = await searchWeb(chosen.searchQuery);
    if (searchResult) {
      context += `\n\nHere's what you found from searching the web:\n${searchResult}`;
    }
  }

  // Twitter/X context
  if (chosen.needsTwitter) {
    try {
      const { getXSummary } = require("./twitter-brain");
      const xData = getXSummary();
      if (xData) {
        context += `\n\nHere's what's happening on X/Twitter right now:\n${xData}`;
      } else {
        // If cache is stale, do a quick fresh search
        const { searchTweets } = require("./twitter-brain");
        const freshTweets = await searchTweets("AI OR tech OR ecommerce", 10);
        if (freshTweets.length > 0) {
          const freshContext = freshTweets.map(t =>
            `@${t.username}: "${t.text.slice(0, 100)}" (${t.likes} likes, ${t.retweets} RTs)`
          ).join("\n");
          context += `\n\nHere's what's happening on X/Twitter right now:\n${freshContext}`;
        }
      }
    } catch (err) {
      console.error("[Harvey Life] Twitter context failed:", err.message);
    }
  }

  // Even for non-twitter outreach types, occasionally sprinkle X data
  if (!chosen.needsTwitter && Math.random() < 0.3) {
    try {
      const { getXSummary } = require("./twitter-brain");
      const xData = getXSummary();
      if (xData) {
        context += `\n\n(optional — if relevant, you can also mention something from X):\n${xData}`;
      }
    } catch {}
  }

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: chosen.prompt + context,
      messages: [{ role: "user", content: "Send the message." }],
    });

    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return text || null;
  } catch (err) {
    console.error("[Harvey Life] Generation failed:", err.message);
    return null;
  }
}

// ─── Start Harvey's Life ─────────────────────────────

function startHarveyLife(harveyBot) {
  const telegram = harveyBot.bot.telegram;
  const addMessage = harveyBot.addMessage; // Inject outreach into conversation history

  console.log(`  [Harvey Life] Active — will reach out to chat ${OWNER_CHAT_ID}`);

  // Twitter brain auto-refresh — DISABLED
  // try {
  //   const { startAutoRefresh } = require("./twitter-brain");
  //   startAutoRefresh(60);
  // } catch (err) {
  //   console.error("[Harvey Life] Twitter brain failed to start:", err.message);
  // }

  // Random interval: every 2-4 hours, check if it's a good time to message
  function scheduleNext() {
    // Random delay: 2-4 hours (in ms)
    const minHours = 2;
    const maxHours = 4;
    const delayMs = (minHours + Math.random() * (maxHours - minHours)) * 60 * 60 * 1000;
    const delayMin = Math.round(delayMs / 60000);

    console.log(`[Harvey Life] Next outreach in ~${delayMin} minutes`);

    setTimeout(async () => {
      try {
        const message = await generateOutreach();
        if (message) {
          await telegram.sendMessage(OWNER_CHAT_ID, message);
          // Inject into Harvey's conversation history so he remembers what he said
          if (addMessage) addMessage(parseInt(OWNER_CHAT_ID), "assistant", [{ type: "text", text: message }]);
          console.log(`[Harvey Life] Sent: "${message.slice(0, 60)}..."`);
        } else {
          console.log("[Harvey Life] Skipped (nighttime or generation failed)");
        }
      } catch (err) {
        console.error("[Harvey Life] Failed to send:", err.message);
      }

      // Schedule the next one
      scheduleNext();
    }, delayMs);
  }

  // First message: 5-15 minutes after boot (don't spam on restart)
  const initialDelay = (5 + Math.random() * 10) * 60 * 1000;
  console.log(`  [Harvey Life] First outreach in ~${Math.round(initialDelay / 60000)} minutes`);

  setTimeout(async () => {
    try {
      const message = await generateOutreach();
      if (message) {
        await telegram.sendMessage(OWNER_CHAT_ID, message);
        // Inject into Harvey's conversation history so he remembers what he said
        if (addMessage) addMessage(parseInt(OWNER_CHAT_ID), "assistant", [{ type: "text", text: message }]);
        console.log(`[Harvey Life] First message sent: "${message.slice(0, 60)}..."`);
      }
    } catch (err) {
      console.error("[Harvey Life] First message failed:", err.message);
    }
    scheduleNext();
  }, initialDelay);
}

module.exports = { startHarveyLife, generateOutreach };
