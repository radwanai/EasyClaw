module.exports = {
  name: 'get_current_time',
  description: 'Get the current time in Pacific timezone (Sameh\'s timezone). Returns formatted time with date.',
  input_schema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['full', 'time_only', 'date_only'],
        description: 'Output format: full=date and time, time_only=just time, date_only=just date',
        default: 'full'
      }
    }
  },
  
  async execute(input) {
    const now = new Date();
    const format = input.format || 'full';
    
    const options_full = {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };
    
    const options_time = {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };
    
    const options_date = {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };
    
    let formatted;
    if (format === 'time_only') {
      formatted = now.toLocaleString('en-US', options_time);
    } else if (format === 'date_only') {
      formatted = now.toLocaleString('en-US', options_date);
    } else {
      formatted = now.toLocaleString('en-US', options_full);
    }
    
    return {
      success: true,
      current_time: formatted,
      timestamp: now.toISOString(),
      timezone: 'America/Los_Angeles (Pacific)'
    };
  }
};
