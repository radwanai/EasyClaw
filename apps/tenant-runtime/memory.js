// memory.js — Smart memory system for Harvey
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "./data";
const MEMORY_FILE = path.join(DATA_DIR, "harvey_memory.json");

// Memory structure:
// {
//   "personal": [{ text, timestamp, tags, keywords, followUp? }],
//   "preferences": [...],
//   "projects": [...],
//   "facts": [...],
//   "general": [...]
// }
// followUp: { status: "pending"|"done", after: ISO string, lastMentioned: null|ISO }

function loadMemories() {
  if (!fs.existsSync(MEMORY_FILE)) {
    return { personal: [], preferences: [], projects: [], facts: [], general: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
  } catch {
    return { personal: [], preferences: [], projects: [], facts: [], general: [] };
  }
}

function saveMemories(memories) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2));
}

// ─── Keyword Extraction (no AI, pure string processing) ───

const STOP_WORDS = new Set([
  "the","a","an","is","was","are","i","my","me","im","he","she","it","we","they",
  "to","of","in","for","on","with","at","by","from","this","that","and","or","but",
  "not","so","just","about","been","have","has","had","will","would","can","could",
  "do","does","did","be","its","also","very","really","like","got","get","getting",
  "going","want","wants","think","know","said","told","thing","things","something",
  "some","any","all","more","much","many","well","way","even","new","make","working",
]);

function extractKeywords(text, tags = []) {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set([...tags.map(t => t.toLowerCase()), ...words])].slice(0, 15);
}

// ─── Core Memory Functions ────────────────────────────

function addMemory(category, text, tags = [], options = {}) {
  const memories = loadMemories();

  const validCategories = ["personal", "preferences", "projects", "facts", "general"];
  if (!validCategories.includes(category)) category = "general";
  if (!memories[category]) memories[category] = [];

  const memory = {
    text,
    timestamp: new Date().toISOString(),
    tags: Array.isArray(tags) ? tags : [],
    keywords: extractKeywords(text, tags),
  };

  // Follow-up tracking
  if (options.followUp) {
    const daysMap = { projects: 2, personal: 3, general: 5, preferences: 0, facts: 0 };
    const days = daysMap[category] || 3;
    if (days > 0) {
      memory.followUp = {
        status: "pending",
        after: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
        lastMentioned: null,
      };
    }
  }

  memories[category].push(memory);

  // Keep last 100 per category
  if (memories[category].length > 100) {
    memories[category] = memories[category].slice(-100);
  }

  saveMemories(memories);
  return { saved: true, category, memory };
}

function searchMemories(query) {
  const memories = loadMemories();
  const results = [];
  const lowerQuery = query.toLowerCase();

  for (const [category, items] of Object.entries(memories)) {
    for (const item of items) {
      const textMatch = item.text.toLowerCase().includes(lowerQuery);
      const tagMatch = (item.tags || []).some(tag => tag.toLowerCase().includes(lowerQuery));
      const kwMatch = (item.keywords || []).some(kw => kw.includes(lowerQuery));
      if (textMatch || tagMatch || kwMatch) {
        results.push({ ...item, category });
      }
    }
  }

  results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return results.slice(0, 20);
}

function getRecentMemories(limit = 10) {
  const memories = loadMemories();
  const all = [];
  for (const [category, items] of Object.entries(memories)) {
    for (const item of items) {
      all.push({ ...item, category });
    }
  }
  all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return all.slice(0, limit);
}

function getMemoriesByCategory(category) {
  const memories = loadMemories();
  return memories[category] || [];
}

// ─── Follow-up & Matching Functions ───────────────────

function getPendingFollowUps() {
  const memories = loadMemories();
  const now = new Date();
  const results = [];

  for (const [category, items] of Object.entries(memories)) {
    for (const item of items) {
      if (item.followUp && item.followUp.status === "pending" && new Date(item.followUp.after) <= now) {
        results.push({ ...item, category });
      }
    }
  }

  // Most overdue first
  results.sort((a, b) => new Date(a.followUp.after) - new Date(b.followUp.after));
  return results.slice(0, 5);
}

function findMatchingMemories(inputKeywords, limit = 3) {
  const memories = loadMemories();
  const lowerInput = inputKeywords.map(k => k.toLowerCase());
  const scored = [];

  for (const [category, items] of Object.entries(memories)) {
    for (const item of items) {
      const memKw = item.keywords || item.tags || [];
      const overlap = memKw.filter(k => lowerInput.some(ik => k.includes(ik) || ik.includes(k)));
      if (overlap.length > 0) {
        scored.push({ ...item, category, matchScore: overlap.length, matchedOn: overlap });
      }
    }
  }

  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, limit);
}

function markFollowUpDone(category, text) {
  const memories = loadMemories();
  const items = memories[category] || [];
  const item = items.find(m => m.text === text && m.followUp);
  if (item) {
    item.followUp.status = "done";
    item.followUp.lastMentioned = new Date().toISOString();
    saveMemories(memories);
    return true;
  }
  return false;
}

module.exports = {
  addMemory,
  searchMemories,
  getRecentMemories,
  getMemoriesByCategory,
  loadMemories,
  saveMemories,
  extractKeywords,
  getPendingFollowUps,
  findMatchingMemories,
  markFollowUpDone,
};
