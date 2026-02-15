// twitter-brain.js — Harvey's X/Twitter Brain
// Reads trending topics, user timelines, and searches for content
// Feeds insights into Harvey Life outreach and on-demand queries

const fs = require("fs");
const path = require("path");

const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET;
const DATA_DIR = process.env.DATA_DIR || "./data";

const CACHE_FILE = path.join(DATA_DIR, "twitter_cache.json");

// Accounts Harvey should follow closely (add more anytime)
const WATCH_ACCOUNTS = [
  "elonmusk",
  "sama",
  "AndrewYNg",
  "ylecun",
  "JeffBezos",
  "satyanadella",
];

// ─── Twitter API Helper ─────────────────────────────

async function twitterGet(endpoint, params = {}) {
  if (!BEARER_TOKEN) return null;

  const url = new URL(`https://api.x.com/2/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
    });

    if (response.status === 429) {
      const resetAt = response.headers.get("x-rate-limit-reset");
      console.log(`[Twitter Brain] Rate limited. Reset: ${resetAt ? new Date(resetAt * 1000).toLocaleTimeString() : "unknown"}`);
      return null;
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Twitter Brain] API error ${response.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error(`[Twitter Brain] Fetch error: ${err.message}`);
    return null;
  }
}

// ─── Core Functions ──────────────────────────────────

/**
 * Search recent tweets about a topic
 * Returns up to 10 recent tweets with engagement data
 */
async function searchTweets(query, maxResults = 10) {
  const data = await twitterGet("tweets/search/recent", {
    query: `${query} -is:retweet lang:en`,
    max_results: Math.max(10, Math.min(maxResults, 100)),
    "tweet.fields": "created_at,public_metrics,author_id,text",
    "user.fields": "name,username,verified",
    expansions: "author_id",
  });

  if (!data || !data.data) return [];

  const users = {};
  if (data.includes && data.includes.users) {
    for (const u of data.includes.users) users[u.id] = u;
  }

  return data.data.map((tweet) => {
    const author = users[tweet.author_id] || {};
    return {
      text: tweet.text,
      author: author.name || "Unknown",
      username: author.username || "unknown",
      likes: tweet.public_metrics?.like_count || 0,
      retweets: tweet.public_metrics?.retweet_count || 0,
      replies: tweet.public_metrics?.reply_count || 0,
      created: tweet.created_at,
    };
  });
}

/**
 * Get a user's recent tweets
 */
async function getUserTweets(username, maxResults = 10) {
  // First get user ID
  const userData = await twitterGet(`users/by/username/${username}`, {
    "user.fields": "name,username,public_metrics",
  });

  if (!userData || !userData.data) return { user: null, tweets: [] };

  const userId = userData.data.id;
  const user = {
    name: userData.data.name,
    username: userData.data.username,
    followers: userData.data.public_metrics?.followers_count || 0,
  };

  // Then get their tweets
  const tweetsData = await twitterGet(`users/${userId}/tweets`, {
    max_results: Math.max(10, Math.min(maxResults, 100)),
    "tweet.fields": "created_at,public_metrics,text",
    exclude: "retweets,replies",
  });

  const tweets = (tweetsData?.data || []).map((t) => ({
    text: t.text,
    likes: t.public_metrics?.like_count || 0,
    retweets: t.public_metrics?.retweet_count || 0,
    replies: t.public_metrics?.reply_count || 0,
    created: t.created_at,
  }));

  return { user, tweets };
}

/**
 * Get trending topics for a location
 * WOEID: 1 = worldwide, 23424768 = Egypt, 23424977 = US
 */
async function getTrending(woeid = 1) {
  // v2 doesn't have a direct trending endpoint with bearer
  // Use search for popular recent content instead
  const queries = [
    "AI OR artificial intelligence",
    "tech OR startup OR innovation",
    "ecommerce OR shopify OR DTC",
  ];

  const results = [];
  for (const q of queries) {
    const tweets = await searchTweets(q, 10);
    results.push(...tweets);
    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  // Sort by total engagement
  results.sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));
  return results.slice(0, 10);
}

/**
 * Check watched accounts for viral/hot posts
 * Returns tweets from followed accounts that are getting high engagement
 */
async function checkWatchedAccounts() {
  const hotPosts = [];

  for (const username of WATCH_ACCOUNTS) {
    try {
      const { user, tweets } = await getUserTweets(username, 10);
      if (!user || tweets.length === 0) continue;

      // Find tweets with above-average engagement
      for (const tweet of tweets) {
        const engagement = tweet.likes + tweet.retweets + tweet.replies;
        if (engagement > 100) {
          hotPosts.push({
            ...tweet,
            author: user.name,
            username: user.username,
            followers: user.followers,
            engagement,
          });
        }
      }

      // Rate limit protection — 1 second between user lookups
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[Twitter Brain] Error checking @${username}:`, err.message);
    }
  }

  // Sort by engagement
  hotPosts.sort((a, b) => b.engagement - a.engagement);
  return hotPosts.slice(0, 10);
}

// ─── Cache System ────────────────────────────────────

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {}
  return { trending: [], watched: [], lastUpdate: null };
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[Twitter Brain] Cache save error:", err.message);
  }
}

/**
 * Refresh the Twitter cache with latest data
 * Called periodically by Harvey Life
 */
async function refreshCache() {
  if (!BEARER_TOKEN) {
    console.log("[Twitter Brain] No bearer token — skipping refresh");
    return null;
  }

  console.log("[Twitter Brain] Refreshing cache...");

  const trending = await getTrending();
  const watched = await checkWatchedAccounts();

  const cache = {
    trending,
    watched,
    lastUpdate: new Date().toISOString(),
  };

  saveCache(cache);
  console.log(`[Twitter Brain] Cache updated: ${trending.length} trending, ${watched.length} hot posts`);
  return cache;
}

/**
 * Get a summary of what's happening on X right now
 * Used by Harvey Life to flavor outreach messages
 */
function getXSummary() {
  const cache = loadCache();
  if (!cache.lastUpdate) return null;

  // Only use cache if less than 2 hours old
  const age = Date.now() - new Date(cache.lastUpdate).getTime();
  if (age > 2 * 60 * 60 * 1000) return null;

  const lines = [];

  if (cache.trending.length > 0) {
    lines.push("trending on X right now:");
    for (const t of cache.trending.slice(0, 5)) {
      lines.push(`- @${t.username}: "${t.text.slice(0, 100)}${t.text.length > 100 ? "..." : ""}" (${t.likes} likes, ${t.retweets} RTs)`);
    }
  }

  if (cache.watched.length > 0) {
    lines.push("\nhot posts from accounts you watch:");
    for (const t of cache.watched.slice(0, 5)) {
      lines.push(`- @${t.username} (${t.author}): "${t.text.slice(0, 100)}${t.text.length > 100 ? "..." : ""}" (${t.likes} likes, ${t.retweets} RTs)`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

// ─── Harvey Tool: On-Demand X Search ─────────────────

/**
 * Tool handler for Harvey to search X on demand
 * Called when user asks "what's trending" or "check X for..."
 */
async function toolSearchX(input) {
  if (!BEARER_TOKEN) return { error: "X/Twitter not configured" };

  try {
    if (input.type === "trending") {
      const trending = await getTrending();
      if (trending.length === 0) return { result: "couldn't find trending content right now" };
      return {
        result: trending.map((t) =>
          `@${t.username}: ${t.text.slice(0, 120)} (${t.likes} likes, ${t.retweets} RTs)`
        ).join("\n\n"),
      };
    }

    if (input.type === "user" && input.username) {
      const { user, tweets } = await getUserTweets(input.username.replace("@", ""), 10);
      if (!user) return { error: `couldn't find @${input.username}` };
      return {
        user: `${user.name} (@${user.username}) — ${user.followers} followers`,
        tweets: tweets.map((t) =>
          `${t.text.slice(0, 120)} (${t.likes} likes, ${t.retweets} RTs)`
        ).join("\n\n"),
      };
    }

    if (input.type === "search" && input.query) {
      const tweets = await searchTweets(input.query, 10);
      if (tweets.length === 0) return { result: `no recent tweets about "${input.query}"` };
      return {
        result: tweets.map((t) =>
          `@${t.username}: ${t.text.slice(0, 120)} (${t.likes} likes)`
        ).join("\n\n"),
      };
    }

    if (input.type === "watched") {
      const hotPosts = await checkWatchedAccounts();
      if (hotPosts.length === 0) return { result: "nothing hot from watched accounts right now" };
      return {
        result: hotPosts.map((t) =>
          `@${t.username} (${t.author}): ${t.text.slice(0, 120)} — ${t.engagement} total engagement`
        ).join("\n\n"),
      };
    }

    return { error: "specify type: trending, user, search, or watched" };
  } catch (err) {
    return { error: `X search failed: ${err.message}` };
  }
}

// ─── Auto-Refresh Timer ──────────────────────────────

let refreshInterval = null;

function startAutoRefresh(intervalMinutes = 60) {
  if (!BEARER_TOKEN) {
    console.log("  [Twitter Brain] Disabled — no bearer token");
    return;
  }

  console.log(`  [Twitter Brain] Active — refreshing every ${intervalMinutes} min`);

  // First refresh after 2 minutes (don't spam on boot)
  setTimeout(async () => {
    await refreshCache();

    // Then refresh on schedule
    refreshInterval = setInterval(async () => {
      await refreshCache();
    }, intervalMinutes * 60 * 1000);
  }, 2 * 60 * 1000);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

module.exports = {
  searchTweets,
  getUserTweets,
  getTrending,
  checkWatchedAccounts,
  refreshCache,
  getXSummary,
  toolSearchX,
  startAutoRefresh,
  stopAutoRefresh,
  WATCH_ACCOUNTS,
};
