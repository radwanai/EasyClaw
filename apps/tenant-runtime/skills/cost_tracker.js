const fs = require('fs');
const path = require('path');

const USAGE_FILE = path.join(process.env.DATA_DIR || './data', 'usage_log.json');
const SETTINGS_FILE = path.join(process.env.DATA_DIR || './data', 'cost_settings.json');

// Claude Sonnet 4.5 pricing per 1M tokens
const PRICING = {
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  // Fallback for unknown models
  default: { input: 3.00, output: 15.00 },
};

function loadUsage() {
  try {
    if (fs.existsSync(USAGE_FILE)) return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {}
  return [];
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {}
  return { daily_limit: 5.00 }; // Default $5/day alert
}

function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

function getCost(entry) {
  const pricing = PRICING[entry.model] || PRICING.default;
  const inputCost = (entry.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (entry.output_tokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

function fmt(d) { return d.toISOString().split('T')[0]; }

function groupBy(entries, keyFn) {
  const groups = {};
  for (const e of entries) {
    const key = keyFn(e);
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  return groups;
}

function summarizeGroup(entries) {
  let totalCost = 0, inputTokens = 0, outputTokens = 0, calls = 0;
  const byAgent = {};
  for (const e of entries) {
    const cost = getCost(e);
    totalCost += cost;
    inputTokens += e.input_tokens;
    outputTokens += e.output_tokens;
    calls++;
    if (!byAgent[e.agent]) byAgent[e.agent] = { cost: 0, calls: 0, input_tokens: 0, output_tokens: 0 };
    byAgent[e.agent].cost += cost;
    byAgent[e.agent].calls++;
    byAgent[e.agent].input_tokens += e.input_tokens;
    byAgent[e.agent].output_tokens += e.output_tokens;
  }
  // Round costs
  for (const a of Object.values(byAgent)) a.cost = Math.round(a.cost * 10000) / 10000;
  return {
    total_cost: Math.round(totalCost * 10000) / 10000,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    api_calls: calls,
    by_agent: byAgent,
  };
}

module.exports = {
  name: 'cost_tracker',
  description: 'Track AI API costs from usage logs. Shows daily/weekly/monthly costs, per-agent breakdown, and spending alerts. Actions: today, daily, weekly, monthly, alert_threshold.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['today', 'daily', 'weekly', 'monthly', 'alert_threshold'],
        description: 'today=current day, daily=last N days, weekly=this week, monthly=this month, alert_threshold=set/check daily limit'
      },
      days: { type: 'number', description: 'Number of days to look back (for daily, default 7)' },
      limit: { type: 'number', description: 'Daily spending limit in USD (for alert_threshold)' },
    },
    required: ['action']
  },

  async execute(input) {
    const usage = loadUsage();

    if (input.action === 'today') {
      const today = fmt(new Date());
      const todayEntries = usage.filter(e => e.ts && e.ts.startsWith(today));
      const summary = summarizeGroup(todayEntries);
      const settings = loadSettings();
      summary.daily_limit = settings.daily_limit;
      summary.over_limit = summary.total_cost > settings.daily_limit;
      summary.remaining = Math.round((settings.daily_limit - summary.total_cost) * 10000) / 10000;
      summary.date = today;
      return { success: true, ...summary };
    }

    if (input.action === 'daily') {
      const days = input.days || 7;
      const result = [];
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = fmt(d);
        const dayEntries = usage.filter(e => e.ts && e.ts.startsWith(dateStr));
        const summary = summarizeGroup(dayEntries);
        result.push({ date: dateStr, ...summary });
      }
      const totalAll = result.reduce((sum, d) => sum + d.total_cost, 0);
      return {
        success: true,
        days: result,
        period_total: Math.round(totalAll * 10000) / 10000,
        daily_average: Math.round((totalAll / days) * 10000) / 10000,
      };
    }

    if (input.action === 'weekly') {
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay()); // Sunday
      weekStart.setHours(0, 0, 0, 0);
      const weekEntries = usage.filter(e => e.ts && new Date(e.ts) >= weekStart);
      const summary = summarizeGroup(weekEntries);
      summary.week_start = fmt(weekStart);
      summary.days_in = now.getDay() + 1;
      summary.projected_weekly = Math.round((summary.total_cost / (now.getDay() + 1)) * 7 * 10000) / 10000;
      return { success: true, ...summary };
    }

    if (input.action === 'monthly') {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthEntries = usage.filter(e => e.ts && e.ts.startsWith(monthStart));
      const summary = summarizeGroup(monthEntries);
      const dayOfMonth = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      summary.month = monthStart;
      summary.days_elapsed = dayOfMonth;
      summary.projected_monthly = Math.round((summary.total_cost / dayOfMonth) * daysInMonth * 10000) / 10000;
      return { success: true, ...summary };
    }

    if (input.action === 'alert_threshold') {
      const settings = loadSettings();
      if (input.limit !== undefined) {
        settings.daily_limit = input.limit;
        saveSettings(settings);
        return { success: true, message: `Daily limit set to $${input.limit}`, daily_limit: input.limit };
      }
      // Check current status
      const today = fmt(new Date());
      const todayEntries = usage.filter(e => e.ts && e.ts.startsWith(today));
      const summary = summarizeGroup(todayEntries);
      return {
        success: true,
        daily_limit: settings.daily_limit,
        today_cost: summary.total_cost,
        over_limit: summary.total_cost > settings.daily_limit,
        remaining: Math.round((settings.daily_limit - summary.total_cost) * 10000) / 10000,
      };
    }

    return { success: false, error: 'Invalid action' };
  }
};
