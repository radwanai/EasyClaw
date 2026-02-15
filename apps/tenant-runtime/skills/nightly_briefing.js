const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || './data';

function readJson(filename) {
  try {
    const fp = path.join(DATA_DIR, filename);
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {}
  return null;
}

function fmt(d) { return d.toISOString().split('T')[0]; }

module.exports = {
  name: 'nightly_briefing',
  description: 'Generate a structured briefing with tasks due, unread emails, upcoming dates, API costs, CRM follow-ups, and memory follow-ups. Actions: generate (full briefing), section (single section).',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['generate', 'section'],
        description: 'generate=full briefing, section=single section only'
      },
      section_name: {
        type: 'string',
        enum: ['tasks', 'emails', 'dates', 'costs', 'contacts', 'followups'],
        description: 'Which section to pull (for section action)'
      },
    },
    required: ['action']
  },

  async execute(input) {
    const today = fmt(new Date());
    const tomorrow = fmt(addDays(new Date(), 1));

    if (input.action === 'section') {
      if (!input.section_name) return { success: false, error: 'section_name required' };
      const section = getSection(input.section_name, today, tomorrow);
      return { success: true, section: input.section_name, data: section };
    }

    if (input.action === 'generate') {
      const briefing = {
        date: today,
        generated_at: new Date().toISOString(),
        tasks: getSection('tasks', today, tomorrow),
        emails: getSection('emails', today, tomorrow),
        dates: getSection('dates', today, tomorrow),
        costs: getSection('costs', today, tomorrow),
        contacts: getSection('contacts', today, tomorrow),
        followups: getSection('followups', today, tomorrow),
      };

      // Calculate urgency score
      let urgency = 0;
      if (briefing.tasks.overdue_count > 0) urgency += briefing.tasks.overdue_count * 2;
      if (briefing.tasks.due_today_count > 0) urgency += briefing.tasks.due_today_count;
      if (briefing.emails.unread_count > 20) urgency += 1;
      if (briefing.contacts.overdue_followups > 0) urgency += briefing.contacts.overdue_followups;
      if (briefing.costs.over_limit) urgency += 3;

      briefing.urgency_level = urgency > 5 ? 'high' : urgency > 2 ? 'medium' : 'low';
      briefing.urgency_score = urgency;

      return { success: true, briefing };
    }

    return { success: false, error: 'Invalid action' };
  }
};

function getSection(name, today, tomorrow) {
  switch (name) {
    case 'tasks': return getTasksSection(today, tomorrow);
    case 'emails': return getEmailsSection();
    case 'dates': return getDatesSection(today);
    case 'costs': return getCostsSection(today);
    case 'contacts': return getContactsSection(today);
    case 'followups': return getFollowupsSection(today);
    default: return { error: 'Unknown section' };
  }
}

function getTasksSection(today, tomorrow) {
  const tasks = readJson('smart_tasks.json') || [];
  const active = tasks.filter(t => t.status === 'active');
  const overdue = active.filter(t => t.due_date && t.due_date < today);
  const dueToday = active.filter(t => t.due_date === today);
  const dueTomorrow = active.filter(t => t.due_date === tomorrow);
  const urgent = active.filter(t => t.priority === 'urgent' || t.priority === 'high');

  return {
    total_active: active.length,
    overdue_count: overdue.length,
    overdue: overdue.map(t => ({ title: t.title, due: t.due_date, priority: t.priority })),
    due_today_count: dueToday.length,
    due_today: dueToday.map(t => ({ title: t.title, priority: t.priority })),
    due_tomorrow: dueTomorrow.map(t => ({ title: t.title, priority: t.priority })),
    high_priority: urgent.map(t => ({ title: t.title, due: t.due_date })),
  };
}

function getEmailsSection() {
  // Check Gmail unread via token existence
  const hasGmail = fs.existsSync(path.join(DATA_DIR, 'gmail_token.json'));
  // Check email cache for Outlook
  const emailCache = readJson('email_cache.json');
  let unreadEstimate = 0;

  if (emailCache && Array.isArray(emailCache)) {
    unreadEstimate = emailCache.filter(e => !e.isRead).length;
  }

  return {
    gmail_connected: hasGmail,
    unread_count: unreadEstimate,
    note: hasGmail ? 'use gmail_unread for exact count' : 'gmail not connected',
  };
}

function getDatesSection(today) {
  const events = readJson('important_dates.json') || [];
  const threeDaysOut = fmt(addDays(new Date(), 3));

  const upcoming = events.map(e => {
    const nextOcc = getNextOccurrence(e.date, e.recurring || 'none');
    const daysUntil = Math.floor((new Date(nextOcc) - new Date(today)) / 86400000);
    return { ...e, next_occurrence: nextOcc, days_until: daysUntil };
  }).filter(e => e.days_until >= 0 && e.days_until <= 3)
    .sort((a, b) => a.days_until - b.days_until);

  return {
    upcoming_3_days: upcoming.map(e => ({
      title: e.title, date: e.next_occurrence, days_until: e.days_until,
      category: e.category, notes: e.notes,
    })),
    count: upcoming.length,
  };
}

function getCostsSection(today) {
  const usage = readJson('usage_log.json') || [];
  const settings = readJson('cost_settings.json') || { daily_limit: 5.00 };

  const todayEntries = usage.filter(e => e.ts && e.ts.startsWith(today));
  let totalCost = 0;
  for (const e of todayEntries) {
    const inputCost = (e.input_tokens / 1_000_000) * 3.00;
    const outputCost = (e.output_tokens / 1_000_000) * 15.00;
    totalCost += inputCost + outputCost;
  }
  totalCost = Math.round(totalCost * 10000) / 10000;

  return {
    today_cost: totalCost,
    daily_limit: settings.daily_limit,
    over_limit: totalCost > settings.daily_limit,
    api_calls_today: todayEntries.length,
  };
}

function getContactsSection(today) {
  const contacts = readJson('personal_crm.json') || [];
  const overdue = contacts.filter(c => c.next_followup && c.next_followup < today);
  const dueToday = contacts.filter(c => c.next_followup === today);

  return {
    overdue_followups: overdue.length,
    overdue: overdue.map(c => ({ name: c.name, company: c.company, due: c.next_followup })),
    due_today: dueToday.map(c => ({ name: c.name, company: c.company })),
    due_today_count: dueToday.length,
  };
}

function getFollowupsSection(today) {
  const memory = readJson('harvey_memory.json');
  if (!memory) return { pending: [], count: 0 };

  const pending = [];
  for (const [category, memories] of Object.entries(memory)) {
    for (const m of memories) {
      if (m.followUp && m.followUp.status === 'pending' && m.followUp.after <= new Date().toISOString()) {
        pending.push({
          category,
          text: m.text,
          due_since: m.followUp.after.split('T')[0],
        });
      }
    }
  }

  return { pending, count: pending.length };
}

// Helper functions
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function getNextOccurrence(dateStr, recurring) {
  const now = new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  let nextDate = new Date(year, month - 1, day);

  if (recurring === 'yearly') {
    nextDate.setFullYear(now.getFullYear());
    if (nextDate < now) nextDate.setFullYear(now.getFullYear() + 1);
  } else if (recurring === 'monthly') {
    nextDate = new Date(now.getFullYear(), now.getMonth(), day);
    if (nextDate < now) nextDate.setMonth(now.getMonth() + 1);
  }

  return fmt(nextDate);
}
