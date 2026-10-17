/**
 * db.js - SQLite database layer using Node.js native node:sqlite DatabaseSync
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, 'nudge.db');
export const db = new DatabaseSync(DB_FILE);

// Set WAL mode and initialize tables
export function initDB() {
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunities(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      title TEXT NOT NULL,
      deadline TEXT,
      done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reminders(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL, -- 'opportunity' | 'task' | 'event'
      ref_id INTEGER NOT NULL,
      remind_at TEXT NOT NULL, -- ISO timestamp
      status TEXT DEFAULT 'scheduled', -- 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rem ON reminders(status, remind_at);

    CREATE TABLE IF NOT EXISTS push_subscriptions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY,
      name TEXT DEFAULT '',
      goal TEXT DEFAULT 'Internships & Jobs',
      college TEXT DEFAULT '',
      major TEXT DEFAULT '',
      grad_year TEXT DEFAULT '',
      target_role TEXT DEFAULT '',
      email TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure default profile row exists
  const existingProfile = db.prepare('SELECT id FROM profile WHERE id = 1').get();
  if (!existingProfile) {
    db.prepare(`
      INSERT INTO profile (id, name, goal, college, major, grad_year, target_role, email)
      VALUES (1, 'User', 'Internships & Jobs', '', '', '', 'Student', '')
    `).run();
  }

  // Ensure at least one conversation exists
  const convCount = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
  if (convCount.count === 0) {
    db.prepare(`
      INSERT INTO conversations (title) VALUES ('General Copilot')
    `).run();
  }
}

// Initialize on load
initDB();

/* ============================================================
   Profile Queries
   ============================================================ */
export function getProfile() {
  const row = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  return row || { id: 1, name: '', goal: 'Internships & Jobs' };
}

export function updateProfile(data) {
  const current = getProfile();
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
    WHERE id = 1
  `).run(name, goal, college, major, grad_year, target_role, email);

  return getProfile();
}

/* ============================================================
   Opportunities Queries
   ============================================================ */
export function getOpportunities(statusFilter = null) {
  if (statusFilter && statusFilter !== 'all') {
    return db.prepare('SELECT * FROM opportunities WHERE status = ? ORDER BY deadline ASC, id DESC').all(statusFilter);
  }
  return db.prepare('SELECT * FROM opportunities ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, id DESC').all();
}

export function getOpportunityById(id) {
  return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
}

export function insertOpportunity({ title, org = null, category = 'other', deadline = null, location = null, url = null, status = 'pending' }) {
  const stmt = db.prepare(`
    INSERT INTO opportunities (title, org, category, deadline, location, url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(title, org, category, deadline, location, url, status);
  return Number(res.lastInsertRowid);
}

export function updateOpportunity(id, fields) {
  const current = getOpportunityById(id);
  if (!current) return null;
  const title = fields.title !== undefined ? fields.title : current.title;
  const org = fields.org !== undefined ? fields.org : current.org;
  const category = fields.category !== undefined ? fields.category : current.category;
  const deadline = fields.deadline !== undefined ? fields.deadline : current.deadline;
  const location = fields.location !== undefined ? fields.location : current.location;
  const url = fields.url !== undefined ? fields.url : current.url;
  const status = fields.status !== undefined ? fields.status : current.status;

  db.prepare(`
    UPDATE opportunities
    SET title = ?, org = ?, category = ?, deadline = ?, location = ?, url = ?, status = ?
    WHERE id = ?
  `).run(title, org, category, deadline, location, url, status, id);

  return getOpportunityById(id);
}

export function updateOpportunityStatus(id, status) {
  db.prepare('UPDATE opportunities SET status = ? WHERE id = ?').run(status, id);
  return getOpportunityById(id);
}

export function deleteOpportunity(id) {
  cancelRemindersFor('opportunity', id);
  return db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
}

export function clearOpportunities() {
  db.prepare("DELETE FROM reminders WHERE kind = 'opportunity'").run();
  return db.prepare('DELETE FROM opportunities').run();
}

export function findDuplicateOpportunity(org, title) {
  if (!org && !title) return null;
  const all = getOpportunities();
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
export function getTasks() {
  return db.prepare('SELECT * FROM tasks ORDER BY done ASC, CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, id DESC').all();
}

export function insertTask({ title, deadline = null, done = 0 }) {
  const stmt = db.prepare('INSERT INTO tasks (title, deadline, done) VALUES (?, ?, ?)');
  const res = stmt.run(title, deadline, done);
  return Number(res.lastInsertRowid);
}

export function toggleTaskDone(id) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return null;
  const newDone = task.done ? 0 : 1;
  db.prepare('UPDATE tasks SET done = ? WHERE id = ?').run(newDone, id);
  return { ...task, done: newDone };
}

export function deleteTask(id) {
  cancelRemindersFor('task', id);
  return db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

/* ============================================================
   Events Queries
   ============================================================ */
export function getEvents() {
  return db.prepare('SELECT * FROM events ORDER BY date ASC, time ASC, id DESC').all();
}

export function insertEvent({ title, date, time = null }) {
  const stmt = db.prepare('INSERT INTO events (title, date, time) VALUES (?, ?, ?)');
  const res = stmt.run(title, date, time);
  return Number(res.lastInsertRowid);
}

export function deleteEvent(id) {
  cancelRemindersFor('event', id);
  return db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

/* ============================================================
   Reminders Queries
   ============================================================ */
export function scheduleReminder(kind, ref_id, remind_at) {
  const stmt = db.prepare(`
    INSERT INTO reminders (kind, ref_id, remind_at, status)
    VALUES (?, ?, ?, 'scheduled')
  `);
  const res = stmt.run(kind, ref_id, remind_at);
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

export function cancelRemindersFor(kind, ref_id) {
  db.prepare(`
    UPDATE reminders SET status = 'cancelled' WHERE kind = ? AND ref_id = ? AND status = 'scheduled'
  `).run(kind, ref_id);
}

/* ============================================================
   Push Subscriptions
   ============================================================ */
export function getPushSubscriptions() {
  return db.prepare('SELECT * FROM push_subscriptions').all();
}

export function insertPushSubscription(endpoint, p256dh, auth) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES (?, ?, ?)
  `);
  return stmt.run(endpoint, p256dh, auth);
}

export function deletePushSubscription(endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

/* ============================================================
   Conversations & Messages
   ============================================================ */
export function getConversations() {
  return db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC, id DESC').all();
}

export function getConversation(id) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

export function createConversation(title = 'New Chat') {
  const stmt = db.prepare('INSERT INTO conversations (title) VALUES (?)');
  const res = stmt.run(title);
  return Number(res.lastInsertRowid);
}

export function updateConversationPending(id, pendingBlob) {
  db.prepare(`
    UPDATE conversations
    SET pending = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    WHERE id = ?
  `).run(pendingBlob ? JSON.stringify(pendingBlob) : null, id);
}

export function getMessages(conversationId) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY id ASC
  `).all(conversationId);
}

export function addMessage(conversationId, role, text, actions = null, imageName = null) {
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

/* ============================================================
   State Snapshot
   ============================================================ */
export function getFullState() {
  const profile = getProfile();
  const opps = getOpportunities();
  const tasks = getTasks();
  const events = getEvents();
  const convs = getConversations();
  return { profile, opps, tasks, events, convs };
}

/* ============================================================
   Reset & Seed Database
   ============================================================ */
export function resetDatabase() {
  db.exec(`
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM reminders;
    DELETE FROM opportunities;
    DELETE FROM tasks;
    DELETE FROM events;
    DELETE FROM push_subscriptions;
    UPDATE profile SET name = 'User', goal = 'Internships & Jobs', college = '', major = '', grad_year = '', target_role = 'Student', email = '' WHERE id = 1;
    INSERT INTO conversations (id, title) VALUES (1, 'General Copilot');
  `);
}

export function seedDatabase(today = '2026-10-15') {
  resetDatabase();

  // Seed sample opportunities relative to current date (2026-10-15)
  const oppStmt = db.prepare(`
    INSERT INTO opportunities (title, org, category, deadline, location, url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  oppStmt.run('Google Summer of Code 2027 Prep', 'Google', 'internship', '2026-10-24', 'Remote', 'https://summerofcode.withgoogle.com', 'pending');
  oppStmt.run('Smart India Hackathon Finals', 'Ministry of Education', 'hackathon', '2026-10-18', 'New Delhi', 'https://sih.gov.in', 'pending');
  oppStmt.run('Microsoft SWE Internship 2027', 'Microsoft', 'internship', '2026-10-20', 'Hyderabad', 'https://careers.microsoft.com', 'applied');
  oppStmt.run('ETHIndia Web3 Hackathon', 'Devfolio', 'hackathon', '2026-11-05', 'Bengaluru', 'https://ethindia.co', 'pending');
  oppStmt.run('Adobe Research Fellowship', 'Adobe', 'scholarship', '2026-10-12', 'San Jose, CA', 'https://research.adobe.com', 'rejected');
  oppStmt.run('Goldman Sachs Engineering Campus Hiring', 'Goldman Sachs', 'internship', '2026-10-29', 'Bengaluru', 'https://goldmansachs.com/careers', 'pending');

  // Seed tasks
  const taskStmt = db.prepare('INSERT INTO tasks (title, deadline, done) VALUES (?, ?, ?)');
  taskStmt.run('Revise DSA graphs & dynamic programming for technical interview', '2026-10-17', 0);
  taskStmt.run('Update Resume with recent AI agent project', '2026-10-19', 1);
  taskStmt.run('Draft statement of purpose for Adobe Fellowship', '2026-10-11', 1);
  taskStmt.run('Gather letters of recommendation from college professors', '2026-10-25', 0);

  // Seed events
  const eventStmt = db.prepare('INSERT INTO events (title, date, time) VALUES (?, ?, ?)');
  eventStmt.run('Microsoft Technical Round 1', '2026-10-17', '14:00');
  eventStmt.run('Devfolio Hackathon Orientation Webinar', '2026-10-21', '18:30');
  eventStmt.run('Campus Placement Talk - Google SWE', '2026-10-23', '11:00');

  // Update profile
  db.prepare(`
    UPDATE profile
    SET name = 'User', goal = 'Internships & Jobs', college = 'University', major = 'Computer Science', grad_year = '2027', target_role = 'Student', email = ''
    WHERE id = 1
  `).run();

  // Add welcome chat message
  addMessage(
    1,
    'bot',
    '👋 Hi there! I am **Nudge**, your AI Opportunity & Deadline Copilot.\n\nI have loaded your demo workspace with current opportunities, upcoming deadlines, and interview schedules. You can drop any link, flyer screenshot (or paste with `Ctrl + V`), or colloquial message here anytime!'
  );
}
