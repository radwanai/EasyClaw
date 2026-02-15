const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(process.env.DATA_DIR || './data', 'personal_crm.json');

function loadContacts() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  return [];
}

function saveContacts(contacts) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(contacts, null, 2));
}

function fmt(d) { return d.toISOString().split('T')[0]; }

module.exports = {
  name: 'personal_crm',
  description: 'Track contacts, relationships, and interactions. Log meetings/calls/emails, set follow-up reminders, and find people. Actions: add_contact, find, update, log_interaction, due_followups, list, delete.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add_contact', 'find', 'update', 'log_interaction', 'due_followups', 'list', 'delete'],
        description: 'Action to perform'
      },
      name: { type: 'string', description: 'Contact name (for add/find/update/delete)' },
      email: { type: 'string', description: 'Email address' },
      phone: { type: 'string', description: 'Phone number' },
      company: { type: 'string', description: 'Company/organization' },
      role: { type: 'string', description: 'Job title/role' },
      relationship: {
        type: 'string',
        enum: ['friend', 'colleague', 'business', 'family', 'other'],
        description: 'Relationship type'
      },
      tags: { type: 'string', description: 'Comma-separated tags' },
      notes: { type: 'string', description: 'Freeform notes about this person' },
      next_followup: { type: 'string', description: 'Next follow-up date (YYYY-MM-DD)' },
      // For log_interaction
      interaction_type: {
        type: 'string',
        enum: ['email', 'call', 'meeting', 'chat', 'text', 'other'],
        description: 'Type of interaction'
      },
      summary: { type: 'string', description: 'Brief summary of the interaction' },
      query: { type: 'string', description: 'Search query (for find)' },
      // For list filtering
      filter_relationship: { type: 'string', description: 'Filter by relationship type' },
      filter_company: { type: 'string', description: 'Filter by company' },
      filter_tag: { type: 'string', description: 'Filter by tag' },
    },
    required: ['action']
  },

  async execute(input) {
    let contacts = loadContacts();
    const today = fmt(new Date());

    // ─── ADD CONTACT ────────────────────────
    if (input.action === 'add_contact') {
      if (!input.name) return { success: false, error: 'Name required' };

      // Check for duplicate
      const existing = contacts.find(c => c.name.toLowerCase() === input.name.toLowerCase());
      if (existing) return { success: false, error: `Contact "${existing.name}" already exists. Use update to modify.` };

      const contact = {
        id: Date.now(),
        name: input.name,
        email: input.email || '',
        phone: input.phone || '',
        company: input.company || '',
        role: input.role || '',
        relationship: input.relationship || 'other',
        tags: input.tags ? input.tags.split(',').map(t => t.trim().toLowerCase()) : [],
        notes: input.notes || '',
        last_contact: null,
        next_followup: input.next_followup || null,
        interactions: [],
        created_at: new Date().toISOString(),
      };
      contacts.push(contact);
      saveContacts(contacts);
      return { success: true, contact, total_contacts: contacts.length };
    }

    // ─── FIND ───────────────────────────────
    if (input.action === 'find') {
      const q = (input.query || input.name || '').toLowerCase();
      if (!q) return { success: false, error: 'Search query or name required' };
      const matches = contacts.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q) ||
        c.tags.some(t => t.includes(q))
      );
      return { success: true, contacts: matches, count: matches.length };
    }

    // ─── UPDATE ─────────────────────────────
    if (input.action === 'update') {
      if (!input.name) return { success: false, error: 'Name required to find contact' };
      const contact = contacts.find(c => c.name.toLowerCase().includes(input.name.toLowerCase()));
      if (!contact) return { success: false, error: 'Contact not found' };

      if (input.email) contact.email = input.email;
      if (input.phone) contact.phone = input.phone;
      if (input.company) contact.company = input.company;
      if (input.role) contact.role = input.role;
      if (input.relationship) contact.relationship = input.relationship;
      if (input.tags) contact.tags = input.tags.split(',').map(t => t.trim().toLowerCase());
      if (input.notes) contact.notes = input.notes;
      if (input.next_followup) contact.next_followup = input.next_followup;

      saveContacts(contacts);
      return { success: true, updated: contact };
    }

    // ─── LOG INTERACTION ────────────────────
    if (input.action === 'log_interaction') {
      if (!input.name) return { success: false, error: 'Contact name required' };
      const contact = contacts.find(c => c.name.toLowerCase().includes(input.name.toLowerCase()));
      if (!contact) return { success: false, error: 'Contact not found. Add them first with add_contact.' };

      const interaction = {
        date: today,
        type: input.interaction_type || 'other',
        summary: input.summary || '',
      };
      contact.interactions.push(interaction);
      contact.last_contact = today;

      // Auto-advance follow-up if it was today or past
      if (contact.next_followup && contact.next_followup <= today) {
        contact.next_followup = null; // Clear, Harvey can set a new one
      }

      // Keep only last 20 interactions to prevent bloat
      if (contact.interactions.length > 20) {
        contact.interactions = contact.interactions.slice(-20);
      }

      saveContacts(contacts);
      return { success: true, logged: interaction, contact_name: contact.name, total_interactions: contact.interactions.length };
    }

    // ─── DUE FOLLOWUPS ──────────────────────
    if (input.action === 'due_followups') {
      const overdue = contacts.filter(c => c.next_followup && c.next_followup < today)
        .map(c => ({ name: c.name, company: c.company, followup_date: c.next_followup, days_overdue: Math.floor((new Date(today) - new Date(c.next_followup)) / 86400000), last_contact: c.last_contact }));
      const dueToday = contacts.filter(c => c.next_followup === today)
        .map(c => ({ name: c.name, company: c.company, last_contact: c.last_contact }));
      const upcoming = contacts.filter(c => c.next_followup && c.next_followup > today && c.next_followup <= fmt(addDays(new Date(), 7)))
        .map(c => ({ name: c.name, company: c.company, followup_date: c.next_followup, days_until: Math.floor((new Date(c.next_followup) - new Date(today)) / 86400000) }));

      // Also flag contacts not contacted in 30+ days
      const stale = contacts.filter(c => {
        if (!c.last_contact) return c.interactions.length > 0; // Has interactions but no last_contact
        const daysSince = Math.floor((new Date(today) - new Date(c.last_contact)) / 86400000);
        return daysSince > 30;
      }).map(c => ({ name: c.name, company: c.company, last_contact: c.last_contact, relationship: c.relationship }));

      return {
        success: true,
        overdue,
        due_today: dueToday,
        upcoming,
        stale_contacts: stale.slice(0, 5), // Top 5 stale
        total_overdue: overdue.length,
        total_due_today: dueToday.length,
      };
    }

    // ─── LIST ───────────────────────────────
    if (input.action === 'list') {
      let filtered = contacts;
      if (input.filter_relationship) filtered = filtered.filter(c => c.relationship === input.filter_relationship);
      if (input.filter_company) filtered = filtered.filter(c => c.company.toLowerCase().includes(input.filter_company.toLowerCase()));
      if (input.filter_tag) {
        const tag = input.filter_tag.toLowerCase();
        filtered = filtered.filter(c => c.tags.includes(tag));
      }
      // Sort by last contact (most recent first), nulls last
      filtered.sort((a, b) => {
        if (!a.last_contact && !b.last_contact) return 0;
        if (!a.last_contact) return 1;
        if (!b.last_contact) return -1;
        return b.last_contact.localeCompare(a.last_contact);
      });
      // Return lightweight list
      const list = filtered.map(c => ({
        name: c.name, company: c.company, role: c.role, relationship: c.relationship,
        last_contact: c.last_contact, next_followup: c.next_followup, tags: c.tags,
      }));
      return { success: true, contacts: list, count: list.length };
    }

    // ─── DELETE ──────────────────────────────
    if (input.action === 'delete') {
      if (!input.name) return { success: false, error: 'Name required' };
      const idx = contacts.findIndex(c => c.name.toLowerCase() === input.name.toLowerCase());
      if (idx === -1) return { success: false, error: 'Contact not found' };
      const deleted = contacts.splice(idx, 1)[0];
      saveContacts(contacts);
      return { success: true, deleted: deleted.name, remaining: contacts.length };
    }

    return { success: false, error: 'Invalid action' };
  }
};

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
