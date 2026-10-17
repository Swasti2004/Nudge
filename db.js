/**
 * db.js - SQLite database layer using Node.js native node:sqlite DatabaseSync
 * Multi-tenant anonymous guest identity and data persistence.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = process.env.DATABASE_PATH || path.join(DATA_DIR, 'nudge.db');

// Ensure database directory exists before opening
const dbDir = path.dirname(DB_FILE);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(DB_FILE);

/**
 * Migration helper: add a column to a table if it doesn't already exist
 */
function ensureColumn(tableName, colName, colDefinition) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = cols.some(c => c.name === colName);
    if (!exists) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDefinition};`);
    }
  } catch (err) {
    console.warn(`Migration notice for ${tableName}.${colName}:`, err.message);
  }
}

// Set WAL mode and initialize tables
export function initDB() {
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS guest_sessions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id TEXT UNIQUE NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      last_seen_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_guest_sess_token ON guest_sessions(session_token);
    CREATE INDEX IF NOT EXISTS idx_guest_sess_id ON guest_sessions(guest_id);

    CREATE TABLE IF NOT EXISTS opportunities(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id TEXT DEFAULT 'default_guest',
      title TEXT NOT NULL,
      org TEXT,
      category TEXT DEFAULT 'other',
      deadline TEXT,
      location TEXT,
      url TEXT,
      status TEXT DEFAULT 'pending', -- 'pending' | 'applied' | 'rejected'
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id TEXT DEFAULT 'default_guest',
      title TEXT NOT NULL,
      deadline TEXT,
      done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id TEXT DEFAULT 'default_guest',
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reminders(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id TEXT DEFAULT 'default_guest',
      kind TEXT NOT NULL, -- 'opportunity' | 'task' | 'event' | 'outreach'
      ref_id INTEGER NOT NULL,
      remind_at TEXT NOT NULL, -- ISO timestamp
      status TEXT DEFAULT 'scheduled', -- 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rem ON reminders(status, remind_at);

    CREATE TABLE IF NOT EXISTS push_subscriptions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id TEXT DEFAULT 'default_guest',
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id TEXT DEFAULT 'default_guest',
      title TEXT NOT NULL,
      pending TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    CREATE TABLE IF NOT EXISTS messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL, -- 'user' | 'bot'
      text TEXT NOT NULL,
      actions TEXT, -- JSON blob of deadline_card or duplicate_verify
      image_name TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_msg ON messages(conversation_id, id);

    CREATE TABLE IF NOT EXISTS profile(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id TEXT DEFAULT 'default_guest',
      name TEXT DEFAULT '',
      goal TEXT DEFAULT 'Internships & Jobs',
      college TEXT DEFAULT '',
      major TEXT DEFAULT '',
      grad_year TEXT DEFAULT '',
      target_role TEXT DEFAULT '',
      email TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS outreach(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id TEXT DEFAULT 'default_guest',
      contact_name TEXT NOT NULL,
      contact_email TEXT,
      organization TEXT,
      role TEXT,
      category TEXT DEFAULT 'internship', -- 'internship' | 'research' | 'referral' | 'fulltime' | 'other'
      subject TEXT,
      body TEXT,
      first_contact_date TEXT,
      status TEXT DEFAULT 'draft', -- 'draft' | 'ready_to_send' | 'sent' | 'followup_due' | 'replied' | 'meeting_scheduled' | 'closed'
      next_followup_date TEXT,
      followup_count INTEGER DEFAULT 0,
      last_followup_date TEXT,
      response_date TEXT,
      notes TEXT,
      opportunity_id INTEGER,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach(status);
    CREATE INDEX IF NOT EXISTS idx_outreach_followup ON outreach(next_followup_date);
  `);

  // Run non-destructive column migrations on existing tables before indexing guest_id
  ensureColumn('opportunities', 'guest_id', "TEXT DEFAULT 'default_guest'");
  ensureColumn('tasks', 'guest_id', "TEXT DEFAULT 'default_guest'");
  ensureColumn('events', 'guest_id', "TEXT DEFAULT 'default_guest'");
  ensureColumn('reminders', 'guest_id', "TEXT DEFAULT 'default_guest'");
  ensureColumn('push_subscriptions', 'guest_id', "TEXT DEFAULT 'default_guest'");
  ensureColumn('conversations', 'guest_id', "TEXT DEFAULT 'default_guest'");
  ensureColumn('profile', 'guest_id', "TEXT DEFAULT 'default_guest'");
  ensureColumn('outreach', 'guest_id', "TEXT DEFAULT 'default_guest'");

  // Create guest_id indexes now that column existence is guaranteed
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_opp_guest ON opportunities(guest_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_guest ON tasks(guest_id);
    CREATE INDEX IF NOT EXISTS idx_events_guest ON events(guest_id);
    CREATE INDEX IF NOT EXISTS idx_rem_guest ON reminders(guest_id);
    CREATE INDEX IF NOT EXISTS idx_push_guest ON push_subscriptions(guest_id);
    CREATE INDEX IF NOT EXISTS idx_conv_guest ON conversations(guest_id);
    CREATE INDEX IF NOT EXISTS idx_prof_guest ON profile(guest_id);
    CREATE INDEX IF NOT EXISTS idx_outreach_guest ON outreach(guest_id);
  `);

  // Ensure default profile row exists for default_guest
  const existingProfile = db.prepare("SELECT id FROM profile WHERE guest_id = 'default_guest'").get();
  if (!existingProfile) {
    db.prepare(`
      INSERT INTO profile (name, goal, college, major, grad_year, target_role, email, guest_id)
      VALUES ('User', 'Internships & Jobs', '', '', '', 'Student', '', 'default_guest')
    `).run();
  }

  // Ensure at least one conversation exists for default_guest
  const convCount = db.prepare("SELECT COUNT(*) as count FROM conversations WHERE guest_id = 'default_guest'").get();
  if (convCount.count === 0) {
    db.prepare(`
      INSERT INTO conversations (title, guest_id) VALUES ('General Copilot', 'default_guest')
    `).run();
  }
}

// Initialize on load
initDB();

/* ============================================================
   Guest Sessions Management
   ============================================================ */

export function createGuestSession(guestId, sessionToken, expiresAt) {
  const stmt = db.prepare(`
    INSERT INTO guest_sessions (guest_id, session_token, expires_at)
    VALUES (?, ?, ?)
  `);
  stmt.run(guestId, sessionToken, expiresAt);
  // Ensure the guest has a profile and default conversation
  getProfile(guestId);
  const convs = getConversations(guestId);
  if (convs.length === 0) {
    createConversation(guestId, 'General Copilot');
  }
  return { guestId, sessionToken, expiresAt };
}

export function getGuestSessionByToken(sessionToken) {
  if (!sessionToken) return null;
  return db.prepare(`
    SELECT * FROM guest_sessions
    WHERE session_token = ?
  `).get(sessionToken);
}

export function touchGuestSession(sessionToken) {
  if (!sessionToken) return;
  try {
    db.prepare(`
      UPDATE guest_sessions
      SET last_seen_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE session_token = ?
    `).run(sessionToken);
  } catch (err) {
    console.warn('Could not touch session:', err.message);
  }
}

export function invalidateGuestSession(sessionToken) {
  if (!sessionToken) return;
  db.prepare('DELETE FROM guest_sessions WHERE session_token = ?').run(sessionToken);
}

export function cleanupExpiredGuestSessions() {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM guest_sessions WHERE expires_at < ?').run(now);
}

/* ============================================================
   Profile Queries
   ============================================================ */

export function getProfile(guestId = 'default_guest') {
  let row = db.prepare('SELECT * FROM profile WHERE guest_id = ? ORDER BY id ASC LIMIT 1').get(guestId);
  if (!row) {
    db.prepare(`
      INSERT INTO profile (name, goal, college, major, grad_year, target_role, email, guest_id)
      VALUES ('User', 'Internships & Jobs', '', '', '', 'Student', '', ?)
    `).run(guestId);
    row = db.prepare('SELECT * FROM profile WHERE guest_id = ? ORDER BY id ASC LIMIT 1').get(guestId);
  }
  return row || { id: 1, name: 'User', goal: 'Internships & Jobs', guest_id: guestId };
}

export function updateProfile(data, guestId = 'default_guest') {
  const current = getProfile(guestId);
  const name = data.name !== undefined ? data.name : current.name;
  const goal = data.goal !== undefined ? data.goal : current.goal;
  const college = data.college !== undefined ? data.college : (current.college || '');
  const major = data.major !== undefined ? data.major : (current.major || '');
  const grad_year = data.grad_year !== undefined ? data.grad_year : (current.grad_year || '');
  const target_role = data.target_role !== undefined ? data.target_role : (current.target_role || '');
  const email = data.email !== undefined ? data.email : (current.email || '');

  db.prepare(`
    UPDATE profile
    SET name = ?, goal = ?, college = ?, major = ?, grad_year = ?, target_role = ?, email = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND guest_id = ?
  `).run(name, goal, college, major, grad_year, target_role, email, current.id, guestId);

  return getProfile(guestId);
}

/* ============================================================
   Opportunities Queries
   ============================================================ */

export function getOpportunities(statusFilter = null, guestId = 'default_guest') {
  // Support flexible argument positions for backward compatibility
  if (typeof statusFilter === 'string' && (statusFilter.startsWith('g_') || statusFilter === 'default_guest') && guestId === 'default_guest') {
    guestId = statusFilter;
    statusFilter = null;
  }

  if (statusFilter && statusFilter !== 'all') {
    return db.prepare(`
      SELECT * FROM opportunities
      WHERE guest_id = ? AND status = ?
      ORDER BY deadline ASC, id DESC
    `).all(guestId, statusFilter);
  }
  return db.prepare(`
    SELECT * FROM opportunities
    WHERE guest_id = ?
    ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, id DESC
  `).all(guestId);
}

export function getOpportunityById(id, guestId = null) {
  if (guestId) {
    return db.prepare('SELECT * FROM opportunities WHERE id = ? AND guest_id = ?').get(id, guestId);
  }
  return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
}

export function insertOpportunity({ title, org = null, category = 'other', deadline = null, location = null, url = null, status = 'pending' }, guestId = 'default_guest') {
  const stmt = db.prepare(`
    INSERT INTO opportunities (title, org, category, deadline, location, url, status, guest_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(title, org, category, deadline, location, url, status, guestId);
  return Number(res.lastInsertRowid);
}

export function updateOpportunity(id, fields, guestId = null) {
  const current = getOpportunityById(id, guestId);
  if (!current) return null;
  const title = fields.title !== undefined ? fields.title : current.title;
  const org = fields.org !== undefined ? fields.org : current.org;
  const category = fields.category !== undefined ? fields.category : current.category;
  const deadline = fields.deadline !== undefined ? fields.deadline : current.deadline;
  const location = fields.location !== undefined ? fields.location : current.location;
  const url = fields.url !== undefined ? fields.url : current.url;
  const status = fields.status !== undefined ? fields.status : current.status;

  if (guestId) {
    db.prepare(`
      UPDATE opportunities
      SET title = ?, org = ?, category = ?, deadline = ?, location = ?, url = ?, status = ?
      WHERE id = ? AND guest_id = ?
    `).run(title, org, category, deadline, location, url, status, id, guestId);
  } else {
    db.prepare(`
      UPDATE opportunities
      SET title = ?, org = ?, category = ?, deadline = ?, location = ?, url = ?, status = ?
      WHERE id = ?
    `).run(title, org, category, deadline, location, url, status, id);
  }

  return getOpportunityById(id, guestId);
}

export function updateOpportunityStatus(id, status, guestId = null) {
  if (guestId) {
    db.prepare('UPDATE opportunities SET status = ? WHERE id = ? AND guest_id = ?').run(status, id, guestId);
  } else {
    db.prepare('UPDATE opportunities SET status = ? WHERE id = ?').run(status, id);
  }
  return getOpportunityById(id, guestId);
}

export function deleteOpportunity(id, guestId = null) {
  cancelRemindersFor('opportunity', id, guestId);
  if (guestId) {
    return db.prepare('DELETE FROM opportunities WHERE id = ? AND guest_id = ?').run(id, guestId);
  }
  return db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
}

export function clearOpportunities(guestId = 'default_guest') {
  db.prepare("DELETE FROM reminders WHERE kind = 'opportunity' AND guest_id = ?").run(guestId);
  return db.prepare('DELETE FROM opportunities WHERE guest_id = ?').run(guestId);
}

export function findDuplicateOpportunity(org, title, guestId = 'default_guest') {
  if (!org && !title) return null;
  const all = getOpportunities(null, guestId);
  const cleanOrg = org ? org.trim().toLowerCase() : '';
  const cleanTitle = title ? title.trim().toLowerCase() : '';

  for (const item of all) {
    const itemOrg = (item.org || '').trim().toLowerCase();
    const itemTitle = (item.title || '').trim().toLowerCase();

    // Direct org match if org is significant
    if (cleanOrg && itemOrg && cleanOrg === itemOrg) {
      return item;
    }
    // Direct title match
    if (cleanTitle && itemTitle && (cleanTitle === itemTitle || itemTitle.includes(cleanTitle) || cleanTitle.includes(itemTitle))) {
      return item;
    }
  }
  return null;
}

/* ============================================================
   Tasks Queries
   ============================================================ */

export function getTasks(guestId = 'default_guest') {
  return db.prepare(`
    SELECT * FROM tasks
    WHERE guest_id = ?
    ORDER BY done ASC, CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, id DESC
  `).all(guestId);
}

export function insertTask({ title, deadline = null, done = 0 }, guestId = 'default_guest') {
  const stmt = db.prepare('INSERT INTO tasks (title, deadline, done, guest_id) VALUES (?, ?, ?, ?)');
  const res = stmt.run(title, deadline, done, guestId);
  return Number(res.lastInsertRowid);
}

export function toggleTaskDone(id, guestId = null) {
  const task = guestId
    ? db.prepare('SELECT * FROM tasks WHERE id = ? AND guest_id = ?').get(id, guestId)
    : db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return null;
  const newDone = task.done ? 0 : 1;
  if (guestId) {
    db.prepare('UPDATE tasks SET done = ? WHERE id = ? AND guest_id = ?').run(newDone, id, guestId);
  } else {
    db.prepare('UPDATE tasks SET done = ? WHERE id = ?').run(newDone, id);
  }
  return { ...task, done: newDone };
}

export function deleteTask(id, guestId = null) {
  cancelRemindersFor('task', id, guestId);
  if (guestId) {
    return db.prepare('DELETE FROM tasks WHERE id = ? AND guest_id = ?').run(id, guestId);
  }
  return db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

/* ============================================================
   Events Queries
   ============================================================ */

export function getEvents(guestId = 'default_guest') {
  return db.prepare(`
    SELECT * FROM events
    WHERE guest_id = ?
    ORDER BY date ASC, time ASC, id DESC
  `).all(guestId);
}

export function insertEvent({ title, date, time = null }, guestId = 'default_guest') {
  const stmt = db.prepare('INSERT INTO events (title, date, time, guest_id) VALUES (?, ?, ?, ?)');
  const res = stmt.run(title, date, time, guestId);
  return Number(res.lastInsertRowid);
}

export function deleteEvent(id, guestId = null) {
  cancelRemindersFor('event', id, guestId);
  if (guestId) {
    return db.prepare('DELETE FROM events WHERE id = ? AND guest_id = ?').run(id, guestId);
  }
  return db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

/* ============================================================
   Reminders Queries
   ============================================================ */

export function scheduleReminder(kind, ref_id, remind_at, guestId = 'default_guest') {
  const stmt = db.prepare(`
    INSERT INTO reminders (kind, ref_id, remind_at, status, guest_id)
    VALUES (?, ?, ?, 'scheduled', ?)
  `);
  const res = stmt.run(kind, ref_id, remind_at, guestId);
  return Number(res.lastInsertRowid);
}

export function getDueReminders(isoNow) {
  return db.prepare(`
    SELECT * FROM reminders
    WHERE status = 'scheduled' AND remind_at <= ?
  `).all(isoNow);
}

export function updateReminderStatus(id, status, sent_at = null) {
  db.prepare(`
    UPDATE reminders SET status = ?, sent_at = ? WHERE id = ?
  `).run(status, sent_at, id);
}

export function cancelRemindersFor(kind, ref_id, guestId = null) {
  if (guestId) {
    db.prepare(`
      UPDATE reminders
      SET status = 'cancelled'
      WHERE kind = ? AND ref_id = ? AND guest_id = ? AND status = 'scheduled'
    `).run(kind, ref_id, guestId);
  } else {
    db.prepare(`
      UPDATE reminders
      SET status = 'cancelled'
      WHERE kind = ? AND ref_id = ? AND status = 'scheduled'
    `).run(kind, ref_id);
  }
}

/* ============================================================
   Push Subscriptions
   ============================================================ */

export function getPushSubscriptions() {
  return db.prepare('SELECT * FROM push_subscriptions').all();
}

export function getPushSubscriptionsForGuest(guestId) {
  return db.prepare('SELECT * FROM push_subscriptions WHERE guest_id = ?').all(guestId);
}

export function insertPushSubscription(endpoint, p256dh, auth, guestId = 'default_guest') {
  // Support calls with (guestId, endpoint, p256dh, auth) or (endpoint, p256dh, auth, guestId)
  if (typeof auth === 'string' && typeof p256dh === 'string' && endpoint && !guestId.startsWith('g_') && guestId !== 'default_guest') {
    // Standard order: (endpoint, p256dh, auth, guestId)
  }
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, guest_id)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(endpoint, p256dh, auth, guestId);
}

export function deletePushSubscription(endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

/* ============================================================
   Conversations & Messages
   ============================================================ */

export function getConversations(guestId = 'default_guest') {
  const convs = db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count,
      (SELECT m.text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) as last_snippet
    FROM conversations c
    WHERE c.guest_id = ?
    ORDER BY c.updated_at DESC, c.id DESC
  `).all(guestId);

  return convs;
}

export function getConversation(id, guestId = null) {
  if (guestId) {
    return db.prepare('SELECT * FROM conversations WHERE id = ? AND guest_id = ?').get(id, guestId);
  }
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

export function createConversation(arg1 = 'default_guest', arg2 = 'New Chat') {
  // Handle signature flexible ordering: createConversation(title) or createConversation(guestId, title)
  let guestId = 'default_guest';
  let title = 'New Chat';

  if (arg1.startsWith('g_') || arg1 === 'default_guest') {
    guestId = arg1;
    title = arg2 || 'New Chat';
  } else {
    title = arg1;
    guestId = arg2 !== 'New Chat' ? arg2 : 'default_guest';
  }

  const stmt = db.prepare('INSERT INTO conversations (title, guest_id) VALUES (?, ?)');
  const res = stmt.run(title, guestId);
  return Number(res.lastInsertRowid);
}

export function renameConversation(id, title, guestId = null) {
  if (guestId) {
    db.prepare(`
      UPDATE conversations
      SET title = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ? AND guest_id = ?
    `).run(title, id, guestId);
  } else {
    db.prepare(`
      UPDATE conversations
      SET title = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ?
    `).run(title, id);
  }
  return getConversation(id, guestId);
}

export function updateConversationTitle(id, title, guestId = null) {
  return renameConversation(id, title, guestId);
}

export function deleteConversation(id, guestId = null) {
  // Verify ownership if guestId is provided
  if (guestId) {
    const existing = getConversation(id, guestId);
    if (!existing) return false;
  }
  // Delete associated messages first
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
  // Delete the conversation
  if (guestId) {
    db.prepare('DELETE FROM conversations WHERE id = ? AND guest_id = ?').run(id, guestId);
  } else {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  // Ensure at least one conversation exists for this guest
  const targetGuest = guestId || 'default_guest';
  const count = db.prepare('SELECT COUNT(*) as count FROM conversations WHERE guest_id = ?').get(targetGuest);
  if (count.count === 0) {
    createConversation(targetGuest, 'General Copilot');
  }
  return true;
}

export function searchConversations(query, guestId = 'default_guest') {
  if (!query || !query.trim()) return getConversations(guestId);
  const q = `%${query.trim()}%`;
  return db.prepare(`
    SELECT DISTINCT c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count,
      (SELECT m.text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) as last_snippet
    FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    WHERE c.guest_id = ? AND (c.title LIKE ? OR m.text LIKE ?)
    ORDER BY c.updated_at DESC, c.id DESC
  `).all(guestId, q, q);
}

export function updateConversationPending(id, pendingBlob, guestId = null) {
  if (guestId) {
    db.prepare(`
      UPDATE conversations
      SET pending = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ? AND guest_id = ?
    `).run(pendingBlob ? JSON.stringify(pendingBlob) : null, id, guestId);
  } else {
    db.prepare(`
      UPDATE conversations
      SET pending = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ?
    `).run(pendingBlob ? JSON.stringify(pendingBlob) : null, id);
  }
}

export function getMessages(conversationId, guestId = null) {
  if (guestId) {
    const conv = getConversation(conversationId, guestId);
    if (!conv) return [];
  }
  return db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY id ASC
  `).all(conversationId);
}

export function addMessage(conversationId, role, text, actions = null, imageName = null, guestId = null) {
  if (guestId) {
    const conv = getConversation(conversationId, guestId);
    if (!conv) throw new Error('Unauthorized conversation access');
  }

  const stmt = db.prepare(`
    INSERT INTO messages (conversation_id, role, text, actions, image_name)
    VALUES (?, ?, ?, ?, ?)
  `);
  const res = stmt.run(
    conversationId,
    role,
    text,
    actions ? JSON.stringify(actions) : null,
    imageName
  );

  db.prepare(`
    UPDATE conversations SET updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now')) WHERE id = ?
  `).run(conversationId);

  return Number(res.lastInsertRowid);
}

export function updateMessageActions(messageId, actions) {
  db.prepare(`
    UPDATE messages SET actions = ? WHERE id = ?
  `).run(actions ? JSON.stringify(actions) : null, messageId);
}

/* ============================================================
   Cold Emailing & Outreach Tracker Queries
   ============================================================ */

export function getOutreachRecords(statusFilter = null, guestId = 'default_guest') {
  if (typeof statusFilter === 'string' && (statusFilter.startsWith('g_') || statusFilter === 'default_guest') && guestId === 'default_guest') {
    guestId = statusFilter;
    statusFilter = null;
  }

  if (statusFilter && statusFilter !== 'all') {
    return db.prepare(`
      SELECT * FROM outreach 
      WHERE guest_id = ? AND status = ? 
      ORDER BY CASE WHEN next_followup_date IS NULL THEN 1 ELSE 0 END, next_followup_date ASC, id DESC
    `).all(guestId, statusFilter);
  }
  return db.prepare(`
    SELECT * FROM outreach 
    WHERE guest_id = ?
    ORDER BY CASE WHEN next_followup_date IS NULL THEN 1 ELSE 0 END, next_followup_date ASC, id DESC
  `).all(guestId);
}

export function getOutreachById(id, guestId = null) {
  if (guestId) {
    return db.prepare('SELECT * FROM outreach WHERE id = ? AND guest_id = ?').get(id, guestId);
  }
  return db.prepare('SELECT * FROM outreach WHERE id = ?').get(id);
}

export function insertOutreach({
  contact_name,
  contact_email = null,
  organization = null,
  role = null,
  category = 'internship',
  subject = null,
  body = null,
  first_contact_date = null,
  status = 'draft',
  next_followup_date = null,
  notes = null,
  opportunity_id = null
}, guestId = 'default_guest') {
  const stmt = db.prepare(`
    INSERT INTO outreach (
      contact_name, contact_email, organization, role, category,
      subject, body, first_contact_date, status, next_followup_date,
      notes, opportunity_id, guest_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(
    contact_name,
    contact_email,
    organization,
    role,
    category,
    subject,
    body,
    first_contact_date,
    status,
    next_followup_date,
    notes,
    opportunity_id,
    guestId
  );
  return Number(res.lastInsertRowid);
}

export function updateOutreach(id, fields, guestId = null) {
  const current = getOutreachById(id, guestId);
  if (!current) return null;

  const contact_name = fields.contact_name !== undefined ? fields.contact_name : current.contact_name;
  const contact_email = fields.contact_email !== undefined ? fields.contact_email : current.contact_email;
  const organization = fields.organization !== undefined ? fields.organization : current.organization;
  const role = fields.role !== undefined ? fields.role : current.role;
  const category = fields.category !== undefined ? fields.category : current.category;
  const subject = fields.subject !== undefined ? fields.subject : current.subject;
  const body = fields.body !== undefined ? fields.body : current.body;
  const first_contact_date = fields.first_contact_date !== undefined ? fields.first_contact_date : current.first_contact_date;
  const status = fields.status !== undefined ? fields.status : current.status;
  const next_followup_date = fields.next_followup_date !== undefined ? fields.next_followup_date : current.next_followup_date;
  const followup_count = fields.followup_count !== undefined ? fields.followup_count : current.followup_count;
  const last_followup_date = fields.last_followup_date !== undefined ? fields.last_followup_date : current.last_followup_date;
  const response_date = fields.response_date !== undefined ? fields.response_date : current.response_date;
  const notes = fields.notes !== undefined ? fields.notes : current.notes;
  const opportunity_id = fields.opportunity_id !== undefined ? fields.opportunity_id : current.opportunity_id;

  if (guestId) {
    db.prepare(`
      UPDATE outreach
      SET contact_name = ?, contact_email = ?, organization = ?, role = ?, category = ?,
          subject = ?, body = ?, first_contact_date = ?, status = ?, next_followup_date = ?,
          followup_count = ?, last_followup_date = ?, response_date = ?, notes = ?,
          opportunity_id = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ? AND guest_id = ?
    `).run(
      contact_name, contact_email, organization, role, category,
      subject, body, first_contact_date, status, next_followup_date,
      followup_count, last_followup_date, response_date, notes,
      opportunity_id, id, guestId
    );
  } else {
    db.prepare(`
      UPDATE outreach
      SET contact_name = ?, contact_email = ?, organization = ?, role = ?, category = ?,
          subject = ?, body = ?, first_contact_date = ?, status = ?, next_followup_date = ?,
          followup_count = ?, last_followup_date = ?, response_date = ?, notes = ?,
          opportunity_id = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ?
    `).run(
      contact_name, contact_email, organization, role, category,
      subject, body, first_contact_date, status, next_followup_date,
      followup_count, last_followup_date, response_date, notes,
      opportunity_id, id
    );
  }

  return getOutreachById(id, guestId);
}

export function markOutreachSent(id, { sent_date = null, next_followup_date = null } = {}, guestId = null) {
  const current = getOutreachById(id, guestId);
  if (!current) return null;

  const actualSentDate = sent_date || (new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10));
  const isFirstContact = !current.first_contact_date;
  const first_contact_date = isFirstContact ? actualSentDate : current.first_contact_date;
  const last_followup_date = isFirstContact ? null : actualSentDate;
  const followup_count = isFirstContact ? current.followup_count : (current.followup_count + 1);

  cancelRemindersFor('outreach', id, guestId);

  if (next_followup_date) {
    const remindAtIso = `${next_followup_date}T03:30:00.000Z`;
    scheduleReminder('outreach', id, remindAtIso, current.guest_id || guestId || 'default_guest');
  }

  if (guestId) {
    db.prepare(`
      UPDATE outreach
      SET status = 'sent',
          first_contact_date = ?,
          last_followup_date = ?,
          followup_count = ?,
          next_followup_date = ?,
          updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ? AND guest_id = ?
    `).run(first_contact_date, last_followup_date, followup_count, next_followup_date, id, guestId);
  } else {
    db.prepare(`
      UPDATE outreach
      SET status = 'sent',
          first_contact_date = ?,
          last_followup_date = ?,
          followup_count = ?,
          next_followup_date = ?,
          updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ?
    `).run(first_contact_date, last_followup_date, followup_count, next_followup_date, id);
  }

  return getOutreachById(id, guestId);
}

export function recordOutreachReply(id, { response_date = null, outcome = 'replied', notes = null } = {}, guestId = null) {
  const current = getOutreachById(id, guestId);
  if (!current) return null;

  cancelRemindersFor('outreach', id, guestId);

  const actualResponseDate = response_date || (new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10));
  const updatedNotes = notes !== null && notes !== undefined ? notes : current.notes;
  const finalStatus = outcome === 'meeting_scheduled' ? 'meeting_scheduled' : 'replied';

  if (guestId) {
    db.prepare(`
      UPDATE outreach
      SET status = ?,
          response_date = ?,
          next_followup_date = NULL,
          notes = ?,
          updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ? AND guest_id = ?
    `).run(finalStatus, actualResponseDate, updatedNotes, id, guestId);
  } else {
    db.prepare(`
      UPDATE outreach
      SET status = ?,
          response_date = ?,
          next_followup_date = NULL,
          notes = ?,
          updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ?
    `).run(finalStatus, actualResponseDate, updatedNotes, id);
  }

  return getOutreachById(id, guestId);
}

export function scheduleOutreachFollowup(id, { next_followup_date, notes = null }, guestId = null) {
  const current = getOutreachById(id, guestId);
  if (!current) return null;

  cancelRemindersFor('outreach', id, guestId);

  if (next_followup_date) {
    const remindAtIso = `${next_followup_date}T03:30:00.000Z`;
    scheduleReminder('outreach', id, remindAtIso, current.guest_id || guestId || 'default_guest');
  }

  const updatedNotes = notes !== null && notes !== undefined ? notes : current.notes;

  if (guestId) {
    db.prepare(`
      UPDATE outreach
      SET next_followup_date = ?,
          notes = ?,
          updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ? AND guest_id = ?
    `).run(next_followup_date, updatedNotes, id, guestId);
  } else {
    db.prepare(`
      UPDATE outreach
      SET next_followup_date = ?,
          notes = ?,
          updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      WHERE id = ?
    `).run(next_followup_date, updatedNotes, id);
  }

  return getOutreachById(id, guestId);
}

export function deleteOutreach(id, guestId = null) {
  cancelRemindersFor('outreach', id, guestId);
  if (guestId) {
    return db.prepare('DELETE FROM outreach WHERE id = ? AND guest_id = ?').run(id, guestId);
  }
  return db.prepare('DELETE FROM outreach WHERE id = ?').run(id);
}

export function getOutreachMetrics(guestId = 'default_guest') {
  const all = db.prepare('SELECT * FROM outreach WHERE guest_id = ?').all(guestId);
  const total = all.length;
  let drafts = 0;
  let sent = 0;
  let replied = 0;
  let meetings = 0;
  let followupDue = 0;

  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

  for (const item of all) {
    if (item.status === 'draft' || item.status === 'ready_to_send') {
      drafts++;
    } else {
      sent++;
    }

    if (item.status === 'replied' || item.status === 'meeting_scheduled') {
      replied++;
    }

    if (item.status === 'meeting_scheduled') {
      meetings++;
    }

    if ((item.status === 'sent' || item.status === 'followup_due') && item.next_followup_date && item.next_followup_date <= today) {
      followupDue++;
    }
  }

  const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;

  return {
    total,
    drafts,
    sent,
    replied,
    replyRate,
    meetings,
    followupDue
  };
}

/* ============================================================
   State Snapshot
   ============================================================ */

export function getFullState(guestId = 'default_guest') {
  const profile = getProfile(guestId);
  const opps = getOpportunities(null, guestId);
  const tasks = getTasks(guestId);
  const events = getEvents(guestId);
  const convs = getConversations(guestId);
  const outreach = getOutreachRecords(null, guestId);
  const outreachMetrics = getOutreachMetrics(guestId);
  return { profile, opps, tasks, events, convs, outreach, outreachMetrics, guestId };
}

/* ============================================================
   Reset & Seed Database
   ============================================================ */

export function resetDatabase(guestId = null) {
  if (guestId) {
    // Scoped reset for a single guest
    db.prepare('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE guest_id = ?)').run(guestId);
    db.prepare('DELETE FROM conversations WHERE guest_id = ?').run(guestId);
    db.prepare('DELETE FROM reminders WHERE guest_id = ?').run(guestId);
    db.prepare('DELETE FROM opportunities WHERE guest_id = ?').run(guestId);
    db.prepare('DELETE FROM tasks WHERE guest_id = ?').run(guestId);
    db.prepare('DELETE FROM events WHERE guest_id = ?').run(guestId);
    db.prepare('DELETE FROM push_subscriptions WHERE guest_id = ?').run(guestId);
    db.prepare('DELETE FROM outreach WHERE guest_id = ?').run(guestId);
    db.prepare(`
      UPDATE profile
      SET name = 'User', goal = 'Internships & Jobs', college = '', major = '', grad_year = '', target_role = 'Student', email = ''
      WHERE guest_id = ?
    `).run(guestId);
    createConversation(guestId, 'General Copilot');
  } else {
    // Global reset (e.g. for complete test runner teardown)
    db.exec(`
      DELETE FROM messages;
      DELETE FROM conversations;
      DELETE FROM reminders;
      DELETE FROM opportunities;
      DELETE FROM tasks;
      DELETE FROM events;
      DELETE FROM push_subscriptions;
      DELETE FROM outreach;
      DELETE FROM guest_sessions;
      UPDATE profile SET name = 'User', goal = 'Internships & Jobs', college = '', major = '', grad_year = '', target_role = 'Student', email = '';
    `);
    createConversation('default_guest', 'General Copilot');
  }
}

export function seedDatabase(today = '2026-10-15', guestId = 'default_guest') {
  resetDatabase(guestId);

  // Seed sample opportunities relative to current date (2026-10-15)
  const oppStmt = db.prepare(`
    INSERT INTO opportunities (title, org, category, deadline, location, url, status, guest_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  oppStmt.run('Google Summer of Code 2027 Prep', 'Google', 'internship', '2026-10-24', 'Remote', 'https://summerofcode.withgoogle.com', 'pending', guestId);
  oppStmt.run('Smart India Hackathon Finals', 'Ministry of Education', 'hackathon', '2026-10-18', 'New Delhi', 'https://sih.gov.in', 'pending', guestId);
  oppStmt.run('Microsoft SWE Internship 2027', 'Microsoft', 'internship', '2026-10-20', 'Hyderabad', 'https://careers.microsoft.com', 'applied', guestId);
  oppStmt.run('ETHIndia Web3 Hackathon', 'Devfolio', 'hackathon', '2026-11-05', 'Bengaluru', 'https://ethindia.co', 'pending', guestId);
  oppStmt.run('Adobe Research Fellowship', 'Adobe', 'scholarship', '2026-10-12', 'San Jose, CA', 'https://research.adobe.com', 'rejected', guestId);
  oppStmt.run('Goldman Sachs Engineering Campus Hiring', 'Goldman Sachs', 'internship', '2026-10-29', 'Bengaluru', 'https://goldmansachs.com/careers', 'pending', guestId);

  // Seed tasks
  const taskStmt = db.prepare('INSERT INTO tasks (title, deadline, done, guest_id) VALUES (?, ?, ?, ?)');
  taskStmt.run('Revise DSA graphs & dynamic programming for technical interview', '2026-10-17', 0, guestId);
  taskStmt.run('Update Resume with recent AI agent project', '2026-10-19', 1, guestId);
  taskStmt.run('Draft statement of purpose for Adobe Fellowship', '2026-10-11', 1, guestId);
  taskStmt.run('Gather letters of recommendation from college professors', '2026-10-25', 0, guestId);

  // Seed events
  const eventStmt = db.prepare('INSERT INTO events (title, date, time, guest_id) VALUES (?, ?, ?, ?)');
  eventStmt.run('Microsoft Technical Round 1', '2026-10-17', '14:00', guestId);
  eventStmt.run('Devfolio Hackathon Orientation Webinar', '2026-10-21', '18:30', guestId);
  eventStmt.run('Campus Placement Talk - Google SWE', '2026-10-23', '11:00', guestId);

  // Seed sample outreach
  const outStmt = db.prepare(`
    INSERT INTO outreach (
      contact_name, contact_email, organization, role, category,
      subject, body, first_contact_date, status, next_followup_date,
      followup_count, notes, guest_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  outStmt.run(
    'Dr. Priya Sharma',
    'priyasharma@google.com',
    'Google DeepMind',
    'Principal Research Scientist',
    'research',
    'Prospective research collaborator / intern inquiry - Gemma 4 fine-tuning',
    'Hi Dr. Sharma,\n\nI have been closely following your recent publications on multimodal reasoning and lightweight agent architectures. As a CS undergraduate passionate about practical agent workflows, I recently built a local copilot integrating Gemma 4 for structured document extraction.\n\nI would love to learn if your lab is considering student research interns for the upcoming cohort. If your schedule allows, could I ask you 1-2 questions via email or a brief 10-minute chat?\n\nBest regards,\nUser',
    '2026-10-12',
    'sent',
    '2026-10-18',
    0,
    'Paper reference: multimodal reasoning in edge agents. Follow-up scheduled for 18 Oct.',
    guestId
  );

  outStmt.run(
    'Arvind Kumar',
    'arvind.k@microsoft.com',
    'Microsoft',
    'Engineering Director - Azure AI',
    'referral',
    'Undergraduate SWE Internship 2027 Referral Inquiry',
    'Dear Arvind,\n\nI hope this email finds you well. I recently applied for the SWE Internship 2027 role at Microsoft (Hyderabad) and wanted to reach out after reading about your team\'s work on distributed AI infrastructure.\n\nWould you be open to providing advice on preparing for Microsoft\'s technical evaluation, or considering me for an employee referral?\n\nThank you for your time!\nUser',
    '2026-10-08',
    'meeting_scheduled',
    null,
    1,
    'Replied on Oct 11! Coffee chat scheduled for Oct 17 at 2:00 PM.',
    guestId
  );

  outStmt.run(
    'Sarah Jenkins',
    'sjenkins@adobe.com',
    'Adobe',
    'University Talent Acquisition',
    'internship',
    'Inquiry regarding Adobe Research Fellowship & Internship Timeline',
    'Hi Sarah,\n\nI am preparing my submission for the Adobe Research Fellowship and wanted to confirm if applicants can also be considered concurrently for the Summer 2027 SWE internship.\n\nThank you for your support of student innovators.\n\nBest,\nUser',
    null,
    'draft',
    null,
    0,
    'Drafted inquiry about dual-consideration policy.',
    guestId
  );

  // Update profile
  db.prepare(`
    UPDATE profile
    SET name = 'User', goal = 'Internships & Jobs', college = 'University', major = 'Computer Science', grad_year = '2027', target_role = 'Student', email = ''
    WHERE guest_id = ?
  `).run(guestId);

  // Add welcome chat message
  const conv = getConversations(guestId)[0];
  if (conv) {
    addMessage(
      conv.id,
      'bot',
      '👋 Hi there! I am **Nudge**, your AI Opportunity & Deadline Copilot.\n\nI have loaded your demo workspace with current opportunities, upcoming deadlines, interview schedules, and cold outreach tracker. You can drop any link, flyer screenshot (or paste with `Ctrl + V`), or colloquial message here anytime!',
      null,
      null,
      guestId
    );
  }
}
