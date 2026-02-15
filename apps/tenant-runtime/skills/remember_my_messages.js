const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'remember_my_messages',
  description: 'Save and recall messages I (Harvey) have sent to Sameh. Can log new messages or search through message history.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['save', 'recall', 'recent'],
        description: 'save=log a message I sent, recall=search my message history, recent=get last N messages'
      },
      message: {
        type: 'string',
        description: 'The message content to save (for action=save)'
      },
      query: {
        type: 'string',
        description: 'Search query to find messages (for action=recall)'
      },
      limit: {
        type: 'number',
        description: 'Number of recent messages to retrieve (for action=recent)',
        default: 10
      }
    },
    required: ['action']
  },
  
  async execute(input) {
    const logFile = path.join('/app', 'my_messages.json');
    
    // Load existing messages
    let messages = [];
    try {
      if (fs.existsSync(logFile)) {
        const data = fs.readFileSync(logFile, 'utf8');
        messages = JSON.parse(data);
      }
    } catch (err) {
      // Start fresh if file doesn't exist or is corrupted
      messages = [];
    }
    
    if (input.action === 'save') {
      if (!input.message) {
        return { success: false, error: 'Message content required for save action' };
      }
      
      const entry = {
        timestamp: new Date().toISOString(),
        message: input.message
      };
      
      messages.push(entry);
      fs.writeFileSync(logFile, JSON.stringify(messages, null, 2));
      
      return { 
        success: true, 
        saved: entry,
        total: messages.length 
      };
    }
    
    if (input.action === 'recall') {
      if (!input.query) {
        return { success: false, error: 'Query required for recall action' };
      }
      
      const query = input.query.toLowerCase();
      const matches = messages.filter(m => 
        m.message.toLowerCase().includes(query)
      );
      
      return {
        success: true,
        matches: matches,
        count: matches.length
      };
    }
    
    if (input.action === 'recent') {
      const limit = input.limit || 10;
      const recent = messages.slice(-limit).reverse();
      
      return {
        success: true,
        messages: recent,
        count: recent.length
      };
    }
    
    return { success: false, error: 'Invalid action' };
  }
};
