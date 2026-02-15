const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(process.env.DATA_DIR || './data', 'smart_tasks.json');

// ─── Natural language date parsing (no deps) ─────────────
function parseDate(str) {
  if (!str) return null;
  const now = new Date();
  const lower = str.toLowerCase().trim();

  // ISO / standard dates
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return lower;

  // Relative keywords
  if (lower === 'today') return fmt(now);
  if (lower === 'tomorrow') return fmt(addDays(now, 1));
  if (lower === 'yesterday') return fmt(addDays(now, -1));

  // "next monday", "next friday"
  const nextDay = lower.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (nextDay) {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const target = days.indexOf(nextDay[1]);
    const current = now.getDay();
    let diff = target - current;
    if (diff <= 0) diff += 7;
    return fmt(addDays(now, diff));
  }

  // "in N days"
  const inDays = lower.match(/^in\s+(\d+)\s+days?$/);
  if (inDays) return fmt(addDays(now, parseInt(inDays[1])));

  // "in N weeks"
  const inWeeks = lower.match(/^in\s+(\d+)\s+weeks?$/);
  if (inWeeks) return fmt(addDays(now, parseInt(inWeeks[1]) * 7));

  // "end of week" (friday)
  if (lower === 'end of week' || lower === 'this week' || lower === 'eow') {
    const friday = 5 - now.getDay();
    return fmt(addDays(now, friday <= 0 ? friday + 7 : friday));
  }

  // "end of month"
  if (lower === 'end of month' || lower === 'eom') {
    const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return fmt(eom);
  }

  // Fallback: try Date.parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return fmt(parsed);

  return str; // Return as-is if can't parse
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmt(d) {
  return d.toISOString().split('T')[0];
}

function loadTasks() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  return [];
}

function saveTasks(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

module.exports = {
  name: 'smart_tasks',
  description: 'Advanced task manager with subtasks, tags, recurring tasks, natural language due dates, and overdue tracking. Actions: add, list, complete, update, delete, search, overdue, summary, add_subtask, complete_subtask.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'complete', 'update', 'delete', 'search', 'overdue', 'summary', 'add_subtask', 'complete_subtask'],
        description: 'Action to perform'
      },
      title: { type: 'string', description: 'Task title (for add/search/delete)' },
      description: { type: 'string', description: 'Details (for add/update)' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Priority level' },
      project: { type: 'string', description: 'Project/category name' },
      due_date: { type: 'string', description: 'Due date: YYYY-MM-DD, "tomorrow", "next friday", "in 3 days", "end of week", "end of month"' },
      tags: { type: 'string', description: 'Comma-separated tags' },
      recurring: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'], description: 'Recurrence (default: none)' },
      task_id: { type: 'number', description: 'Task ID (for complete/update/delete/add_subtask)' },
      subtask: { type: 'string', description: 'Subtask title (for add_subtask)' },
      subtask_index: { type: 'number', description: 'Subtask index to complete (for complete_subtask)' },
      query: { type: 'string', description: 'Search query' },
      status: { type: 'string', enum: ['active', 'completed', 'all'], description: 'Filter by status (for list, default: active)' },
    },
    required: ['action']
  },

  async execute(input) {
    let tasks = loadTasks();
    const today = fmt(new Date());

    // ─── ADD ────────────────────────────────
    if (input.action === 'add') {
      if (!input.title) return { success: false, error: 'Title required' };
      const task = {
        id: Date.now(),
        title: input.title,
        description: input.description || '',
        priority: input.priority || 'medium',
        project: input.project || '',
        due_date: parseDate(input.due_date) || null,
        tags: input.tags ? input.tags.split(',').map(t => t.trim().toLowerCase()) : [],
        recurring: input.recurring || 'none',
        subtasks: [],
        status: 'active',
        created_at: new Date().toISOString(),
        completed_at: null,
      };
      tasks.push(task);
      saveTasks(tasks);
      return { success: true, task, total_active: tasks.filter(t => t.status === 'active').length };
    }

    // ─── LIST ───────────────────────────────
    if (input.action === 'list') {
      const filter = input.status || 'active';
      let filtered = tasks;
      if (filter !== 'all') filtered = tasks.filter(t => t.status === filter);
      if (input.project) filtered = filtered.filter(t => t.project.toLowerCase().includes(input.project.toLowerCase()));
      if (input.tags) {
        const searchTags = input.tags.split(',').map(t => t.trim().toLowerCase());
        filtered = filtered.filter(t => searchTags.some(st => t.tags.includes(st)));
      }
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      filtered.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
      return { success: true, tasks: filtered, count: filtered.length };
    }

    // ─── COMPLETE ───────────────────────────
    if (input.action === 'complete') {
      const task = findTask(tasks, input);
      if (!task) return { success: false, error: 'Task not found' };
      task.status = 'completed';
      task.completed_at = new Date().toISOString();

      // Handle recurring: create next instance
      if (task.recurring && task.recurring !== 'none' && task.due_date) {
        const intervals = { daily: 1, weekly: 7, monthly: 30 };
        const nextDue = addDays(new Date(task.due_date), intervals[task.recurring] || 7);
        const newTask = {
          ...task,
          id: Date.now(),
          status: 'active',
          due_date: fmt(nextDue),
          completed_at: null,
          created_at: new Date().toISOString(),
          subtasks: task.subtasks.map(s => ({ ...s, done: false })),
        };
        tasks.push(newTask);
      }
      saveTasks(tasks);
      return { success: true, completed: task.title, recurring_next: task.recurring !== 'none' ? 'created next instance' : null };
    }

    // ─── UPDATE ─────────────────────────────
    if (input.action === 'update') {
      const task = findTask(tasks, input);
      if (!task) return { success: false, error: 'Task not found' };
      if (input.title) task.title = input.title;
      if (input.description) task.description = input.description;
      if (input.priority) task.priority = input.priority;
      if (input.project) task.project = input.project;
      if (input.due_date) task.due_date = parseDate(input.due_date);
      if (input.tags) task.tags = input.tags.split(',').map(t => t.trim().toLowerCase());
      if (input.recurring) task.recurring = input.recurring;
      saveTasks(tasks);
      return { success: true, updated: task };
    }

    // ─── DELETE ──────────────────────────────
    if (input.action === 'delete') {
      const task = findTask(tasks, input);
      if (!task) return { success: false, error: 'Task not found' };
      tasks = tasks.filter(t => t.id !== task.id);
      saveTasks(tasks);
      return { success: true, deleted: task.title, remaining: tasks.filter(t => t.status === 'active').length };
    }

    // ─── SEARCH ─────────────────────────────
    if (input.action === 'search') {
      if (!input.query) return { success: false, error: 'Query required' };
      const q = input.query.toLowerCase();
      const matches = tasks.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.project.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.includes(q))
      );
      return { success: true, matches, count: matches.length };
    }

    // ─── OVERDUE ────────────────────────────
    if (input.action === 'overdue') {
      const overdue = tasks.filter(t =>
        t.status === 'active' && t.due_date && t.due_date < today
      ).sort((a, b) => a.due_date.localeCompare(b.due_date));
      const dueSoon = tasks.filter(t =>
        t.status === 'active' && t.due_date && t.due_date >= today && t.due_date <= fmt(addDays(new Date(), 2))
      ).sort((a, b) => a.due_date.localeCompare(b.due_date));
      return { success: true, overdue, due_soon: dueSoon, overdue_count: overdue.length, due_soon_count: dueSoon.length };
    }

    // ─── SUMMARY ────────────────────────────
    if (input.action === 'summary') {
      const active = tasks.filter(t => t.status === 'active');
      const overdue = active.filter(t => t.due_date && t.due_date < today);
      const weekAgo = fmt(addDays(new Date(), -7));
      const completedThisWeek = tasks.filter(t => t.status === 'completed' && t.completed_at && t.completed_at.slice(0, 10) >= weekAgo);
      const byPriority = { urgent: 0, high: 0, medium: 0, low: 0 };
      active.forEach(t => { byPriority[t.priority] = (byPriority[t.priority] || 0) + 1; });
      const projects = [...new Set(active.map(t => t.project).filter(Boolean))];
      return {
        success: true,
        total_active: active.length,
        overdue_count: overdue.length,
        completed_this_week: completedThisWeek.length,
        by_priority: byPriority,
        projects,
      };
    }

    // ─── ADD SUBTASK ────────────────────────
    if (input.action === 'add_subtask') {
      const task = findTask(tasks, input);
      if (!task) return { success: false, error: 'Task not found' };
      if (!input.subtask) return { success: false, error: 'Subtask title required' };
      task.subtasks.push({ title: input.subtask, done: false, added_at: new Date().toISOString() });
      saveTasks(tasks);
      return { success: true, task_title: task.title, subtasks: task.subtasks };
    }

    // ─── COMPLETE SUBTASK ───────────────────
    if (input.action === 'complete_subtask') {
      const task = findTask(tasks, input);
      if (!task) return { success: false, error: 'Task not found' };
      const idx = input.subtask_index;
      if (idx === undefined || idx < 0 || idx >= task.subtasks.length) return { success: false, error: 'Invalid subtask index' };
      task.subtasks[idx].done = true;
      saveTasks(tasks);
      const allDone = task.subtasks.every(s => s.done);
      return { success: true, subtask: task.subtasks[idx].title, all_subtasks_done: allDone, subtasks: task.subtasks };
    }

    return { success: false, error: 'Invalid action' };
  }
};

function findTask(tasks, input) {
  if (input.task_id) return tasks.find(t => t.id === input.task_id);
  if (input.title) return tasks.find(t => t.title.toLowerCase().includes(input.title.toLowerCase()) && t.status === 'active');
  return null;
}
