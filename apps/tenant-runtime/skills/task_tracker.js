const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'task_tracker',
  description: 'Track tasks, todos, and ongoing projects. Manage follow-ups and see what needs attention.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'complete', 'update', 'delete', 'active', 'search'],
        description: 'add=new task, list=all, complete=mark done, update=modify, delete=remove, active=incomplete only, search=find tasks'
      },
      title: {
        type: 'string',
        description: 'Task title (for add/search/delete)'
      },
      description: {
        type: 'string',
        description: 'Detailed description (for add/update)'
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'urgent'],
        description: 'Task priority (for add/update)',
        default: 'medium'
      },
      project: {
        type: 'string',
        description: 'Project name/category (for add/update)'
      },
      due_date: {
        type: 'string',
        description: 'Due date YYYY-MM-DD (for add/update)'
      },
      task_id: {
        type: 'number',
        description: 'Task ID (for complete/update/delete)'
      },
      query: {
        type: 'string',
        description: 'Search query (for search)'
      }
    },
    required: ['action']
  },
  
  async execute(input) {
    const dataFile = path.join('/app', 'tasks.json');
    
    let tasks = [];
    try {
      if (fs.existsSync(dataFile)) {
        const data = fs.readFileSync(dataFile, 'utf8');
        tasks = JSON.parse(data);
      }
    } catch (err) {
      tasks = [];
    }
    
    if (input.action === 'add') {
      if (!input.title) {
        return { success: false, error: 'Title required' };
      }
      
      const task = {
        id: Date.now(),
        title: input.title,
        description: input.description || '',
        priority: input.priority || 'medium',
        project: input.project || '',
        due_date: input.due_date || null,
        status: 'active',
        created_at: new Date().toISOString(),
        completed_at: null
      };
      
      tasks.push(task);
      fs.writeFileSync(dataFile, JSON.stringify(tasks, null, 2));
      
      return {
        success: true,
        added: task,
        total: tasks.length
      };
    }
    
    if (input.action === 'list') {
      return {
        success: true,
        tasks: tasks.sort((a, b) => {
          const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }),
        count: tasks.length
      };
    }
    
    if (input.action === 'active') {
      const active = tasks.filter(t => t.status === 'active')
        .sort((a, b) => {
          const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
      
      return {
        success: true,
        tasks: active,
        count: active.length
      };
    }
    
    if (input.action === 'complete') {
      if (!input.task_id && !input.title) {
        return { success: false, error: 'Task ID or title required' };
      }
      
      let task;
      if (input.task_id) {
        task = tasks.find(t => t.id === input.task_id);
      } else {
        task = tasks.find(t => t.title.toLowerCase().includes(input.title.toLowerCase()));
      }
      
      if (!task) {
        return { success: false, error: 'Task not found' };
      }
      
      task.status = 'completed';
      task.completed_at = new Date().toISOString();
      
      fs.writeFileSync(dataFile, JSON.stringify(tasks, null, 2));
      
      return {
        success: true,
        completed: task
      };
    }
    
    if (input.action === 'update') {
      if (!input.task_id && !input.title) {
        return { success: false, error: 'Task ID or title required' };
      }
      
      let task;
      if (input.task_id) {
        task = tasks.find(t => t.id === input.task_id);
      } else {
        task = tasks.find(t => t.title.toLowerCase().includes(input.title.toLowerCase()));
      }
      
      if (!task) {
        return { success: false, error: 'Task not found' };
      }
      
      if (input.description) task.description = input.description;
      if (input.priority) task.priority = input.priority;
      if (input.project) task.project = input.project;
      if (input.due_date) task.due_date = input.due_date;
      
      fs.writeFileSync(dataFile, JSON.stringify(tasks, null, 2));
      
      return {
        success: true,
        updated: task
      };
    }
    
    if (input.action === 'search') {
      if (!input.query) {
        return { success: false, error: 'Query required for search' };
      }
      
      const query = input.query.toLowerCase();
      const matches = tasks.filter(t => 
        t.title.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        (t.project && t.project.toLowerCase().includes(query))
      );
      
      return {
        success: true,
        matches: matches,
        count: matches.length
      };
    }
    
    if (input.action === 'delete') {
      if (!input.task_id && !input.title) {
        return { success: false, error: 'Task ID or title required' };
      }
      
      const beforeCount = tasks.length;
      
      if (input.task_id) {
        tasks = tasks.filter(t => t.id !== input.task_id);
      } else {
        tasks = tasks.filter(t => !t.title.toLowerCase().includes(input.title.toLowerCase()));
      }
      
      if (tasks.length < beforeCount) {
        fs.writeFileSync(dataFile, JSON.stringify(tasks, null, 2));
        return {
          success: true,
          deleted: beforeCount - tasks.length,
          remaining: tasks.length
        };
      } else {
        return {
          success: false,
          error: 'Task not found'
        };
      }
    }
    
    return { success: false, error: 'Invalid action' };
  }
};
