const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'important_dates',
  description: 'Manage important dates, birthdays, holidays, and reminders. Can add events, check upcoming dates, and get reminders for things like getting gifts ahead of time.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'upcoming', 'search', 'delete'],
        description: 'add=new event, list=all events, upcoming=next N events, search=find events, delete=remove event'
      },
      title: {
        type: 'string',
        description: 'Event title (for add/search/delete)'
      },
      date: {
        type: 'string',
        description: 'Date in YYYY-MM-DD format (for add)'
      },
      recurring: {
        type: 'string',
        enum: ['none', 'yearly', 'monthly'],
        description: 'Recurrence type (for add)',
        default: 'none'
      },
      category: {
        type: 'string',
        enum: ['birthday', 'holiday', 'reminder', 'event', 'other'],
        description: 'Event category (for add)',
        default: 'other'
      },
      remind_days_before: {
        type: 'number',
        description: 'Days before event to start reminding (for add)',
        default: 0
      },
      notes: {
        type: 'string',
        description: 'Additional notes (for add)'
      },
      days: {
        type: 'number',
        description: 'Number of days to look ahead (for upcoming)',
        default: 30
      }
    },
    required: ['action']
  },
  
  async execute(input) {
    const dataFile = path.join('/app', 'important_dates.json');
    
    // Load existing events
    let events = [];
    try {
      if (fs.existsSync(dataFile)) {
        const data = fs.readFileSync(dataFile, 'utf8');
        events = JSON.parse(data);
      }
    } catch (err) {
      events = [];
    }
    
    // Helper to calculate next occurrence
    const getNextOccurrence = (dateStr, recurring, fromDate = new Date()) => {
      const [year, month, day] = dateStr.split('-').map(Number);
      let nextDate = new Date(year, month - 1, day);
      
      if (recurring === 'yearly') {
        const currentYear = fromDate.getFullYear();
        nextDate.setFullYear(currentYear);
        if (nextDate < fromDate) {
          nextDate.setFullYear(currentYear + 1);
        }
      } else if (recurring === 'monthly') {
        const currentYear = fromDate.getFullYear();
        const currentMonth = fromDate.getMonth();
        nextDate = new Date(currentYear, currentMonth, day);
        if (nextDate < fromDate) {
          nextDate.setMonth(currentMonth + 1);
        }
      }
      
      return nextDate;
    };
    
    if (input.action === 'add') {
      if (!input.title || !input.date) {
        return { success: false, error: 'Title and date required' };
      }
      
      const event = {
        id: Date.now(),
        title: input.title,
        date: input.date,
        recurring: input.recurring || 'none',
        category: input.category || 'other',
        remind_days_before: input.remind_days_before || 0,
        notes: input.notes || '',
        created_at: new Date().toISOString()
      };
      
      events.push(event);
      fs.writeFileSync(dataFile, JSON.stringify(events, null, 2));
      
      return {
        success: true,
        added: event,
        total: events.length
      };
    }
    
    if (input.action === 'list') {
      return {
        success: true,
        events: events.sort((a, b) => a.date.localeCompare(b.date)),
        count: events.length
      };
    }
    
    if (input.action === 'upcoming') {
      const now = new Date();
      const daysAhead = input.days || 30;
      const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
      
      const upcoming = events.map(event => {
        const nextOccurrence = getNextOccurrence(event.date, event.recurring, now);
        const daysUntil = Math.floor((nextOccurrence - now) / (24 * 60 * 60 * 1000));
        
        return {
          ...event,
          next_occurrence: nextOccurrence.toISOString().split('T')[0],
          days_until: daysUntil,
          should_remind: event.remind_days_before > 0 && daysUntil <= event.remind_days_before && daysUntil >= 0
        };
      })
      .filter(e => e.days_until >= 0 && e.days_until <= daysAhead)
      .sort((a, b) => a.days_until - b.days_until);
      
      return {
        success: true,
        upcoming: upcoming,
        count: upcoming.length,
        needs_reminder: upcoming.filter(e => e.should_remind)
      };
    }
    
    if (input.action === 'search') {
      if (!input.title) {
        return { success: false, error: 'Title/query required for search' };
      }
      
      const query = input.title.toLowerCase();
      const matches = events.filter(e => 
        e.title.toLowerCase().includes(query) ||
        (e.notes && e.notes.toLowerCase().includes(query))
      );
      
      return {
        success: true,
        matches: matches,
        count: matches.length
      };
    }
    
    if (input.action === 'delete') {
      if (!input.title) {
        return { success: false, error: 'Title required for delete' };
      }
      
      const beforeCount = events.length;
      events = events.filter(e => e.title.toLowerCase() !== input.title.toLowerCase());
      
      if (events.length < beforeCount) {
        fs.writeFileSync(dataFile, JSON.stringify(events, null, 2));
        return {
          success: true,
          deleted: true,
          remaining: events.length
        };
      } else {
        return {
          success: false,
          error: 'Event not found'
        };
      }
    }
    
    return { success: false, error: 'Invalid action' };
  }
};
