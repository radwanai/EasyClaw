const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'quick_notes',
  description: 'Quick notes system for random ideas, thoughts, and things to remember. Brain dump anything without structure.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'search', 'delete', 'recent'],
        description: 'add=new note, list=all notes, search=find notes, delete=remove note, recent=last N notes'
      },
      content: {
        type: 'string',
        description: 'Note content (for add)'
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for organization (for add)'
      },
      query: {
        type: 'string',
        description: 'Search query (for search/delete)'
      },
      limit: {
        type: 'number',
        description: 'Number of recent notes (for recent)',
        default: 10
      }
    },
    required: ['action']
  },
  
  async execute(input) {
    const dataFile = path.join('/app', 'quick_notes.json');
    
    let notes = [];
    try {
      if (fs.existsSync(dataFile)) {
        const data = fs.readFileSync(dataFile, 'utf8');
        notes = JSON.parse(data);
      }
    } catch (err) {
      notes = [];
    }
    
    if (input.action === 'add') {
      if (!input.content) {
        return { success: false, error: 'Content required' };
      }
      
      const note = {
        id: Date.now(),
        content: input.content,
        tags: input.tags || [],
        created_at: new Date().toISOString()
      };
      
      notes.unshift(note); // Add to beginning
      fs.writeFileSync(dataFile, JSON.stringify(notes, null, 2));
      
      return {
        success: true,
        added: note,
        total: notes.length
      };
    }
    
    if (input.action === 'list') {
      return {
        success: true,
        notes: notes,
        count: notes.length
      };
    }
    
    if (input.action === 'recent') {
      const limit = input.limit || 10;
      return {
        success: true,
        notes: notes.slice(0, limit),
        count: notes.slice(0, limit).length
      };
    }
    
    if (input.action === 'search') {
      if (!input.query) {
        return { success: false, error: 'Query required for search' };
      }
      
      const query = input.query.toLowerCase();
      const matches = notes.filter(n => 
        n.content.toLowerCase().includes(query) ||
        n.tags.some(tag => tag.toLowerCase().includes(query))
      );
      
      return {
        success: true,
        matches: matches,
        count: matches.length
      };
    }
    
    if (input.action === 'delete') {
      if (!input.query) {
        return { success: false, error: 'Query or ID required for delete' };
      }
      
      const id = parseInt(input.query);
      const beforeCount = notes.length;
      
      if (!isNaN(id)) {
        notes = notes.filter(n => n.id !== id);
      } else {
        const query = input.query.toLowerCase();
        notes = notes.filter(n => !n.content.toLowerCase().includes(query));
      }
      
      if (notes.length < beforeCount) {
        fs.writeFileSync(dataFile, JSON.stringify(notes, null, 2));
        return {
          success: true,
          deleted: beforeCount - notes.length,
          remaining: notes.length
        };
      } else {
        return {
          success: false,
          error: 'Note not found'
        };
      }
    }
    
    return { success: false, error: 'Invalid action' };
  }
};
