/**
 * server.js - Express backend for Nudge Copilot
 * Persistent Anonymous User Identity, Multi-tenant Isolation, and Production Hardening
 */
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';

dotenv.config();

import {
  db,
  createGuestSession,
  getGuestSessionByToken,
  touchGuestSession,
  getProfile,
  updateProfile,
  getOpportunities,
  getOpportunityById,
  insertOpportunity,
  updateOpportunity,
  updateOpportunityStatus,
  deleteOpportunity,
  clearOpportunities,
  findDuplicateOpportunity,
  getTasks,
  insertTask,
  toggleTaskDone,
  deleteTask,
  getEvents,
  insertEvent,
  deleteEvent,
  scheduleReminder,
  cancelRemindersFor,
  insertPushSubscription,
  getConversations,
  getConversation,
  createConversation,
  renameConversation,
  deleteConversation,
  searchConversations,
  updateConversationPending,
  getMessages,
  addMessage,
  updateMessageActions,
  getOutreachRecords,
  getOutreachById,
  insertOutreach,
  updateOutreach,
  markOutreachSent,
  recordOutreachReply,
  scheduleOutreachFollowup,
  deleteOutreach,
  getOutreachMetrics,
  getFullState,
  resetDatabase,
  seedDatabase
} from './db.js';

import { processUserInput, generateColdEmailDraft } from './ai.js';
import { todayIST, formatDateIST, daysUntil, countdownText, addDays } from './dates.js';
import { vapidKeys, startScheduler, sendPushToGuest, sendPushToAll } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Cookie Parser Helper
 */
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts[0]?.trim();
    if (!name) return;
    const value = parts.slice(1).join('=').trim();
    try {
      list[name] = decodeURIComponent(value);
    } catch {
      list[name] = value;
    }
  });
  return list;
}

/**
 * Middleware: Persistent Cryptographically Random Anonymous Guest Identity
 */
app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.nudge_guest;
  let session = null;

  if (token && typeof token === 'string' && /^[0-9a-fA-F]{64}$/.test(token)) {
    session = getGuestSessionByToken(token);
  }

  const now = new Date();
  if (session && new Date(session.expires_at) > now) {
    req.guestId = session.guest_id;
    touchGuestSession(token);
  } else {
    // Generate fresh cryptographically secure guest session
    const guestId = 'g_' + crypto.randomBytes(16).toString('hex');
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(); // 1 year lifetime

    createGuestSession(guestId, sessionToken, expiresAt);
    req.guestId = guestId;

    const isProd = process.env.NODE_ENV === 'production';
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const secureFlag = (isProd || isHttps) ? '; Secure' : '';

    res.setHeader(
      'Set-Cookie',
      `nudge_guest=${sessionToken}; Path=/; Max-Age=${365 * 24 * 3600}; HttpOnly; SameSite=Lax${secureFlag}`
    );
  }

  next();
});

/**
 * Lightweight in-memory rate limiter for compute/AI-intensive routes
 */
const rateLimitBuckets = new Map();
function rateLimit(maxRequests = 40, windowMs = 60000) {
  return (req, res, next) => {
    const key = `${req.guestId || req.ip}:${req.path}`;
    const now = Date.now();
    let bucket = rateLimitBuckets.get(key);

    if (!bucket || now - bucket.startTime > windowMs) {
      bucket = { count: 1, startTime: now };
      rateLimitBuckets.set(key, bucket);
      return next();
    }

    bucket.count++;
    if (bucket.count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment before sending another message.',
        code: 'RATE_LIMIT'
      });
    }

    next();
  };
}

// Clean up stale rate-limit buckets every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (now - bucket.startTime > 120000) {
      rateLimitBuckets.delete(key);
    }
  }
}, 300000);
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

// Static frontend files
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Health check endpoint for Railway and deployment monitors
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/**
 * Schedule automated reminders for an opportunity based on deadline
 */
function scheduleOppReminders(oppId, deadlineStr, leadDays = 3, guestId = 'default_guest') {
  if (!deadlineStr) return;
  const days = daysUntil(deadlineStr);
  const today = todayIST();

  let remindDateStr = addDays(-leadDays, deadlineStr);
  if (days <= leadDays) {
    remindDateStr = today;
  }

  // 9:00 AM IST = 03:30 UTC
  const remindAtIso = `${remindDateStr}T03:30:00.000Z`;
  scheduleReminder('opportunity', oppId, remindAtIso, guestId);
}

/**
 * Schedule automated reminders for an academic task
 */
function scheduleTaskReminders(taskId, deadlineStr, leadDays = 1, guestId = 'default_guest') {
  if (!deadlineStr) return;
  const days = daysUntil(deadlineStr);
  const today = todayIST();

  let remindDateStr = addDays(-leadDays, deadlineStr);
  if (days <= leadDays) {
    remindDateStr = today;
  }

  // 9:00 AM IST = 03:30 UTC
  const remindAtIso = `${remindDateStr}T03:30:00.000Z`;
  scheduleReminder('task', taskId, remindAtIso, guestId);
}

/* ============================================================
   REST API Endpoints (All Scoped Strictly to req.guestId)
   ============================================================ */

// 1. Full state
app.get('/api/state', (req, res) => {
  try {
    const state = getFullState(req.guestId);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Chat history for a conversation
app.get('/api/chat/:convId/messages', (req, res) => {
  try {
    const convId = parseInt(req.params.convId, 10);
    const conv = getConversation(convId, req.guestId);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const msgs = getMessages(convId, req.guestId);
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Conversations list / create / search / rename / delete
app.get('/api/conversations', (req, res) => {
  try {
    res.json(getConversations(req.guestId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversations', (req, res) => {
  try {
    const title = req.body.title || 'New Copilot Chat';
    const id = createConversation(req.guestId, title);
    res.json({ id, title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/conversations/search', (req, res) => {
  try {
    const { q } = req.query;
    res.json(searchConversations(q, req.guestId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/conversations/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    const existing = getConversation(id, req.guestId);
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const conv = renameConversation(id, title.trim(), req.guestId);
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/conversations/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getConversation(id, req.guestId);
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    deleteConversation(id, req.guestId);
    res.json({ success: true, id, state: getFullState(req.guestId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Post chat message with rate-limiting
app.post('/api/chat', rateLimit(30, 60000), async (req, res) => {
  try {
    let { conversation_id, text = '', image = null } = req.body;

    if (!conversation_id) {
      const convs = getConversations(req.guestId);
      conversation_id = convs.length > 0 ? convs[0].id : createConversation(req.guestId);
    } else {
      const conv = getConversation(conversation_id, req.guestId);
      if (!conv) {
        const convs = getConversations(req.guestId);
        conversation_id = convs.length > 0 ? convs[0].id : createConversation(req.guestId);
      }
    }

    if (!text && !image) {
      return res.status(400).json({ error: 'Message text or image is required' });
    }

    // Retrieve prior conversation history for context continuity
    const history = getMessages(conversation_id, req.guestId).slice(-8);

    // Persist user message
    addMessage(conversation_id, 'user', text, null, image ? 'uploaded_poster.png' : null, req.guestId);

    // Run AI Extraction pipeline with conversation history
    const aiResult = await processUserInput({ text, image, history });
    const { intent, items = [] } = aiResult;

    // Auto-generate a readable conversation title if it's the first message and still default
    const currentConv = getConversation(conversation_id, req.guestId);
    if (currentConv && (currentConv.title === 'New Chat' || currentConv.title === 'New Copilot Chat' || currentConv.title === 'General Copilot')) {
      const allMsgs = getMessages(conversation_id, req.guestId);
      const userCount = allMsgs.filter(m => m.role === 'user').length;
      if (userCount <= 1) {
        let autoTitle = '';
        if (items.length > 0 && items[0].title && items[0].title !== 'Opportunity' && items[0].title !== 'Provided Date') {
          autoTitle = items[0].title;
        } else if (text) {
          autoTitle = text.replace(/https?:\/\/[^\s]+/g, '').replace(/[^\w\s-]/g, '').trim().split(/\s+/).slice(0, 5).join(' ');
        }
        if (autoTitle && autoTitle.length > 3) {
          renameConversation(conversation_id, autoTitle.substring(0, 34), req.guestId);
        }
      }
    }

    // Handle Intent 1: ask_deadlines
    if (intent === 'ask_deadlines') {
      const opps = getOpportunities('pending', req.guestId);
      const tasks = getTasks(req.guestId).filter(t => !t.done);
      const events = getEvents(req.guestId);

      let reply = `### 📅 Here is what's coming up on your radar:\n\n`;

      if (opps.length === 0 && tasks.length === 0 && events.length === 0) {
        reply += `✨ *No upcoming deadlines right now! You're completely caught up.*`;
      } else {
        if (opps.length > 0) {
          reply += `**🎯 Pending Opportunities:**\n`;
          opps.forEach(o => {
            const count = countdownText(o.deadline);
            reply += `• **${o.title}** ${o.org ? `(${o.org})` : ''} — Due **${formatDateIST(o.deadline)}** *(${count})*\n`;
          });
          reply += `\n`;
        }

        if (tasks.length > 0) {
          reply += `**📋 Active Tasks:**\n`;
          tasks.forEach(t => {
            const count = t.deadline ? countdownText(t.deadline) : 'No date set';
            reply += `• ${t.title} ${t.deadline ? `— Due **${formatDateIST(t.deadline)}** *(${count})*` : ''}\n`;
          });
          reply += `\n`;
        }

        if (events.length > 0) {
          reply += `**🗓️ Upcoming Events:**\n`;
          events.forEach(e => {
            reply += `• **${e.title}** on **${formatDateIST(e.date)}** ${e.time ? `at ${e.time}` : ''}\n`;
          });
        }
      }

      addMessage(conversation_id, 'bot', reply, null, null, req.guestId);
      return res.json({
        role: 'bot',
        text: reply,
        actions: null,
        state: getFullState(req.guestId)
      });
    }

    // Handle Intent 2: chitchat
    if (intent === 'chitchat') {
      const reply = `👋 Hi! I am **Nudge**, your AI-powered student opportunity & deadline copilot.\n\n` +
        `Here is what you can do:\n` +
        `• **Paste a URL** to an internship, hackathon, or fellowship page.\n` +
        `• **Upload a screenshot or poster flyer** from WhatsApp, LinkedIn, or Instagram.\n` +
        `• **Type naturally** (*"remind me to apply for Google SWE next Friday"*).\n` +
        `• **Ask anytime**: *"What is due this week?"*`;

      addMessage(conversation_id, 'bot', reply, null, null, req.guestId);
      return res.json({
        role: 'bot',
        text: reply,
        actions: null,
        state: getFullState(req.guestId)
      });
    }

    // Handle Intent 3: ask_clarification
    if (intent === 'ask_clarification' || aiResult.needs_clarification) {
      const reply = aiResult.question || `❓ Could you clarify the exact deadline or opportunity details you'd like to track?`;
      addMessage(conversation_id, 'bot', reply, null, null, req.guestId);
      return res.json({
        role: 'bot',
        text: reply,
        actions: null,
        state: getFullState(req.guestId)
      });
    }

    // Handle Intent 4: add_task
    if (intent === 'add_task' && items.length > 0) {
      const item = items[0];
      const taskDate = item.deadline || item.reminder_at || null;
      const taskId = insertTask({
        title: item.title,
        deadline: taskDate,
        done: 0
      }, req.guestId);

      if (taskDate) {
        scheduleTaskReminders(taskId, taskDate, 1, req.guestId);
      }

      const count = taskDate ? ` (${countdownText(taskDate)})` : '';
      const reply = `✅ Added task: **${item.title}**${taskDate ? ` — due/reminder date on **${formatDateIST(taskDate)}**${count}` : ''}.`;
      addMessage(conversation_id, 'bot', reply, null, null, req.guestId);
      return res.json({
        role: 'bot',
        text: reply,
        actions: null,
        state: getFullState(req.guestId)
      });
    }

    // Handle Intent 5: add_event
    if (intent === 'add_event' && items.length > 0) {
      const item = items[0];
      const eventDate = item.deadline || todayIST();
      insertEvent({
        title: item.title,
        date: eventDate,
        time: item.time || null
      }, req.guestId);

      const reply = `✅ Added **${item.title}** to your events calendar for **${formatDateIST(eventDate)}** ${item.time ? 'at ' + item.time : ''}.`;
      addMessage(conversation_id, 'bot', reply, null, null, req.guestId);
      return res.json({
        role: 'bot',
        text: reply,
        actions: null,
        state: getFullState(req.guestId)
      });
    }

    // Handle Intent 6: save_opportunity or extracted opportunity items
    if (items.length > 0) {
      const item = items[0];

      // Check for duplicate opportunity within this guest's data
      const duplicate = findDuplicateOpportunity(item.org, item.title, req.guestId);
      if (duplicate) {
        const actions = {
          type: 'duplicate_verify',
          existing: {
            id: duplicate.id,
            title: duplicate.title,
            org: duplicate.org,
            deadline: duplicate.deadline,
            status: duplicate.status
          },
          incoming: {
            title: item.title,
            org: item.org || duplicate.org,
            category: item.category || duplicate.category,
            deadline: item.deadline || duplicate.deadline,
            location: item.location,
            url: item.url
          }
        };

        const reply = `⚠️ **Duplicate Found:** I noticed you already have an entry for **${duplicate.title}** with deadline **${formatDateIST(duplicate.deadline) || 'Unset'}**.\n\nHow would you like to handle this?`;

        addMessage(conversation_id, 'bot', reply, actions, null, req.guestId);
        return res.json({
          role: 'bot',
          text: reply,
          actions,
          state: getFullState(req.guestId)
        });
      }

      // No duplicate: Render the interactive 2-Option Deadline Card
      const hasExplicitDate = !!item.deadline;
      const suggestedDate = item.deadline || addDays(3);
      const countdown = countdownText(suggestedDate);

      const actions = {
        type: 'deadline_card',
        item: {
          title: item.title,
          org: item.org,
          category: item.category || 'internship',
          deadline: suggestedDate,
          suggested_deadline: suggestedDate,
          has_explicit_date: hasExplicitDate,
          evidence: item.evidence || 'none',
          location: item.location,
          url: item.url
        }
      };

      let sourceLabel = '';
      if (item.evidence === 'image') sourceLabel = 'extracted directly from your uploaded poster/photo';
      else if (item.evidence === 'page') sourceLabel = 'extracted directly from the website listing';
      else if (item.evidence === 'text' && hasExplicitDate) sourceLabel = 'extracted from your message';

      let reply = '';
      if (hasExplicitDate) {
        reply = `🎯 I captured **${item.title}**${item.org ? ` from **${item.org}**` : ''}!\n` +
          `📅 **Deadline (${sourceLabel}):** **${formatDateIST(suggestedDate)}** *(${countdown})*.\n\n` +
          `Please confirm with 1-click or override with a custom date below:`;
      } else {
        reply = `🎯 I captured **${item.title}**${item.org ? ` from **${item.org}**` : ''}!\n` +
          `ℹ️ *No deadline was explicitly stated in the source.* Pre-filled suggested deadline (+3 days): **${formatDateIST(suggestedDate)}** *(${countdown})*.\n\n` +
          `Please confirm or choose the exact date below:`;
      }

      addMessage(conversation_id, 'bot', reply, actions, null, req.guestId);
      return res.json({
        role: 'bot',
        text: reply,
        actions,
        state: getFullState(req.guestId)
      });
    }

    // Fallback: Message does not match the purpose of this project
    const reply = `⚠️ **This message doesn't match the purpose of this project.**\n\n` +
      `**Nudge** is an AI copilot specifically built for **tracking student opportunities, deadlines, application lifecycles, and academic tasks**.\n\n` +
      `Here is what you can do instead:\n` +
      `• **Paste an internship, job, or hackathon link**\n` +
      `• **Paste a flyer or screenshot** directly with \`Ctrl + V\`\n` +
      `• **Schedule a task deadline** (*"Remind me to submit my essay this Friday"*)\n` +
      `• **Track an interview or event** (*"Microsoft interview on Oct 20 at 2pm"*)\n` +
      `• **Check your schedule** (*"What's due this week?"*)`;

    addMessage(conversation_id, 'bot', reply, null, null, req.guestId);
    return res.json({
      role: 'bot',
      text: reply,
      actions: null,
      state: getFullState(req.guestId)
    });

  } catch (err) {
    console.error('Error in /api/chat:', err);
    const safeMsg = err.safeMessage || err.message || 'An error occurred while processing your request.';
    const botErrorReply = `⚠️ **AI Processing Error:** ${safeMsg}`;
    if (req.body && req.body.conversation_id) {
      try {
        addMessage(req.body.conversation_id, 'bot', botErrorReply, null, null, req.guestId);
      } catch {}
    }
    res.status(err.code === 'MISSING_API_KEY' ? 400 : 502).json({
      error: safeMsg,
      code: err.code || 'AI_ERROR',
      text: botErrorReply,
      state: getFullState(req.guestId)
    });
  }
});

// 4. Handle card interactive actions
app.post('/api/action', (req, res) => {
  try {
    const { action, payload, conversation_id, message_id } = req.body;

    if (conversation_id) {
      const conv = getConversation(conversation_id, req.guestId);
      if (!conv) {
        return res.status(403).json({ error: 'Unauthorized conversation access' });
      }
    }

    if (message_id) {
      try {
        const msg = db.prepare('SELECT actions FROM messages WHERE id = ?').get(message_id);
        if (msg && msg.actions) {
          const actObj = typeof msg.actions === 'string' ? JSON.parse(msg.actions) : msg.actions;
          actObj.confirmed = true;
          actObj.confirmed_action = action;
          actObj.confirmed_at = new Date().toISOString();
          updateMessageActions(message_id, actObj);
        }
      } catch (err) {
        console.warn('Could not update message actions state:', err.message);
      }
    }

    let botReply = '';
    let updatedItem = null;

    if (action === 'accept_suggested') {
      const oppId = insertOpportunity({
        title: payload.title,
        org: payload.org || null,
        category: payload.category || 'other',
        deadline: payload.deadline,
        location: payload.location || null,
        url: payload.url || null,
        status: 'pending'
      }, req.guestId);

      scheduleOppReminders(oppId, payload.deadline, 3, req.guestId);
      updatedItem = getOpportunityById(oppId, req.guestId);
      botReply = `✅ Saved **${payload.title}**! Deadline confirmed for **${formatDateIST(payload.deadline)}** (${countdownText(payload.deadline)}). Proactive reminders are scheduled! 🚀`;
    }

    else if (action === 'set_manual') {
      const oppId = insertOpportunity({
        title: payload.title,
        org: payload.org || null,
        category: payload.category || 'other',
        deadline: payload.deadline,
        location: payload.location || null,
        url: payload.url || null,
        status: 'pending'
      }, req.guestId);

      scheduleOppReminders(oppId, payload.deadline, 3, req.guestId);
      updatedItem = getOpportunityById(oppId, req.guestId);
      botReply = `✅ Saved **${payload.title}** with custom deadline **${formatDateIST(payload.deadline)}** (${countdownText(payload.deadline)}). We will nudge you before it's due! 🚀`;
    }

    else if (action === 'dup_update') {
      updateOpportunity(payload.existingId, {
        deadline: payload.deadline,
        status: 'pending'
      }, req.guestId);
      scheduleOppReminders(payload.existingId, payload.deadline, 3, req.guestId);
      updatedItem = getOpportunityById(payload.existingId, req.guestId);
      botReply = `🔄 Updated existing entry **${updatedItem ? updatedItem.title : 'opportunity'}**! New deadline is **${formatDateIST(payload.deadline)}** and status has been reset to **Pending**.`;
    }

    else if (action === 'dup_add_anyway') {
      const oppId = insertOpportunity({
        title: payload.title,
        org: payload.org || null,
        category: payload.category || 'other',
        deadline: payload.deadline,
        location: payload.location || null,
        url: payload.url || null,
        status: 'pending'
      }, req.guestId);
      scheduleOppReminders(oppId, payload.deadline, 3, req.guestId);
      updatedItem = getOpportunityById(oppId, req.guestId);
      botReply = `➕ Added **${payload.title}** as a separate new entry with deadline **${formatDateIST(payload.deadline)}**.`;
    }

    else if (action === 'dup_cancel') {
      botReply = `👌 Kept existing record unchanged. Discarded the duplicate entry.`;
    }

    else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    if (conversation_id && botReply) {
      addMessage(conversation_id, 'bot', botReply, null, null, req.guestId);
    }

    res.json({
      success: true,
      botReply,
      item: updatedItem,
      state: getFullState(req.guestId)
    });

  } catch (err) {
    console.error('Error in /api/action:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   Cold Emailing & Outreach Tracker Endpoints
   ============================================================ */

app.get('/api/outreach', (req, res) => {
  try {
    const { status } = req.query;
    res.json({
      records: getOutreachRecords(status, req.guestId),
      metrics: getOutreachMetrics(req.guestId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/outreach/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const record = getOutreachById(id, req.guestId);
    if (!record) return res.status(404).json({ error: 'Outreach record not found' });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outreach', (req, res) => {
  try {
    const {
      contact_name, contact_email, organization, role, category,
      subject, body, first_contact_date, status, next_followup_date,
      notes, opportunity_id
    } = req.body;

    if (!contact_name || !contact_name.trim()) {
      return res.status(400).json({ error: 'Contact name is required' });
    }

    const id = insertOutreach({
      contact_name: contact_name.trim(),
      contact_email: contact_email ? contact_email.trim() : null,
      organization: organization ? organization.trim() : null,
      role: role ? role.trim() : null,
      category: category || 'internship',
      subject: subject || null,
      body: body || null,
      first_contact_date: first_contact_date || null,
      status: status || 'draft',
      next_followup_date: next_followup_date || null,
      notes: notes || null,
      opportunity_id: opportunity_id ? parseInt(opportunity_id, 10) : null
    }, req.guestId);

    if (next_followup_date && status === 'sent') {
      const remindAtIso = `${next_followup_date}T03:30:00.000Z`;
      scheduleReminder('outreach', id, remindAtIso, req.guestId);
    }

    res.json({
      success: true,
      record: getOutreachById(id, req.guestId),
      metrics: getOutreachMetrics(req.guestId),
      state: getFullState(req.guestId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/outreach/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getOutreachById(id, req.guestId);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    const updated = updateOutreach(id, req.body, req.guestId);
    res.json({
      success: true,
      record: updated,
      metrics: getOutreachMetrics(req.guestId),
      state: getFullState(req.guestId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outreach/:id/sent', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getOutreachById(id, req.guestId);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    const { sent_date, next_followup_date } = req.body;
    const updated = markOutreachSent(id, { sent_date, next_followup_date }, req.guestId);
    res.json({
      success: true,
      record: updated,
      metrics: getOutreachMetrics(req.guestId),
      state: getFullState(req.guestId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outreach/:id/reply', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getOutreachById(id, req.guestId);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    const { response_date, outcome, notes } = req.body;
    const updated = recordOutreachReply(id, { response_date, outcome, notes }, req.guestId);
    res.json({
      success: true,
      record: updated,
      metrics: getOutreachMetrics(req.guestId),
      state: getFullState(req.guestId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outreach/:id/followup', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getOutreachById(id, req.guestId);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    const { next_followup_date, notes } = req.body;
    if (!next_followup_date) {
      return res.status(400).json({ error: 'next_followup_date is required' });
    }
    const updated = scheduleOutreachFollowup(id, { next_followup_date, notes }, req.guestId);
    res.json({
      success: true,
      record: updated,
      metrics: getOutreachMetrics(req.guestId),
      state: getFullState(req.guestId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/outreach/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getOutreachById(id, req.guestId);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    deleteOutreach(id, req.guestId);
    res.json({
      success: true,
      id,
      metrics: getOutreachMetrics(req.guestId),
      state: getFullState(req.guestId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outreach/draft', rateLimit(25, 60000), async (req, res) => {
  try {
    const {
      purpose, recipient_name, recipient_role, recipient_org,
      user_background, opportunity_details, tone, is_followup
    } = req.body;

    const profile = getProfile(req.guestId);
    const defaultBg = profile.college || profile.major 
      ? `${profile.major ? profile.major + ' major' : 'Student'}${profile.college ? ' at ' + profile.college : ''}${profile.grad_year ? ' (Class of ' + profile.grad_year + ')' : ''}`
      : 'Computer Science undergraduate student';

    const draft = await generateColdEmailDraft({
      purpose: purpose || 'internship',
      recipient_name: recipient_name || '',
      recipient_role: recipient_role || '',
      recipient_org: recipient_org || '',
      user_background: user_background || defaultBg,
      opportunity_details: opportunity_details || '',
      tone: tone || 'professional',
      is_followup: !!is_followup
    });

    res.json(draft);
  } catch (err) {
    console.error('Error in /api/outreach/draft:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Opportunities endpoints
app.get('/api/opportunities', (req, res) => {
  try {
    const { status } = req.query;
    res.json(getOpportunities(status, req.guestId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/opportunities', (req, res) => {
  try {
    const { title, org, category, deadline, location, url, status } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const id = insertOpportunity({ title, org, category, deadline, location, url, status }, req.guestId);
    if (deadline) scheduleOppReminders(id, deadline, 3, req.guestId);
    res.json(getOpportunityById(id, req.guestId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/opportunities/:id/status', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!['pending', 'applied', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const existing = getOpportunityById(id, req.guestId);
    if (!existing) return res.status(404).json({ error: 'Opportunity not found' });

    const updated = updateOpportunityStatus(id, status, req.guestId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/opportunities/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getOpportunityById(id, req.guestId);
    if (!existing) return res.status(404).json({ error: 'Opportunity not found' });

    deleteOpportunity(id, req.guestId);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/opportunities', (req, res) => {
  try {
    clearOpportunities(req.guestId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Tasks endpoints
app.get('/api/tasks', (req, res) => {
  try {
    res.json(getTasks(req.guestId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const { title, deadline } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const id = insertTask({ title, deadline }, req.guestId);
    res.json({ id, title, deadline, done: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/:id/done', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = toggleTaskDone(id, req.guestId);
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    deleteTask(id, req.guestId);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Events endpoints
app.get('/api/events', (req, res) => {
  try {
    res.json(getEvents(req.guestId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events', (req, res) => {
  try {
    const { title, date, time } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'Title and date are required' });
    const id = insertEvent({ title, date, time }, req.guestId);
    res.json({ id, title, date, time });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/events/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    deleteEvent(id, req.guestId);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Profile endpoints
app.get('/api/profile', (req, res) => {
  try {
    res.json(getProfile(req.guestId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    const updated = updateProfile(req.body, req.guestId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Seed & Reset (Scoped Strictly to the Calling Guest)
app.post('/api/seed', (req, res) => {
  try {
    seedDatabase(todayIST(), req.guestId);
    res.json({ success: true, state: getFullState(req.guestId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', (req, res) => {
  try {
    resetDatabase(req.guestId);
    res.json({ success: true, state: getFullState(req.guestId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Web Push notification endpoints
app.get('/api/push/key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription payload' });
    }
    insertPushSubscription(endpoint, keys.p256dh, keys.auth, req.guestId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/push/test', async (req, res) => {
  try {
    const payload = {
      title: 'Nudge: Test Notification',
      body: 'Your proactive deadline alerts are properly configured and operational! 🚀',
      url: '/?v=opps',
      tag: 'test-push'
    };
    const result = await sendPushToGuest(req.guestId, payload);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Export Reports and Data to Excel (.xlsx) - Scoped Strictly to Guest
app.get('/api/export/excel', (req, res) => {
  try {
    const opps = getOpportunities(null, req.guestId);
    const tasks = getTasks(req.guestId);
    const events = getEvents(req.guestId);
    const profile = getProfile(req.guestId);
    const today = todayIST();

    const totalOpps = opps.length;
    const appliedOpps = opps.filter(o => o.status === 'applied').length;
    const pendingOpps = opps.filter(o => o.status === 'pending').length;
    const rejectedOpps = opps.filter(o => o.status === 'rejected').length;
    const appliedPct = totalOpps > 0 ? Math.round((appliedOpps / totalOpps) * 100) : 0;
    const activeTasks = tasks.filter(t => !t.done).length;
    const completedTasks = tasks.filter(t => t.done).length;

    // Sheet 1: Executive Performance Summary
    const summaryData = [
      { Metric: 'Student Name', Value: profile.name || 'N/A' },
      { Metric: 'Primary Career Goal', Value: profile.goal || 'N/A' },
      { Metric: 'College / University', Value: profile.college || 'N/A' },
      { Metric: 'Major / Discipline', Value: profile.major || 'N/A' },
      { Metric: 'Target Role', Value: profile.target_role || 'N/A' },
      { Metric: 'Graduation Year', Value: profile.grad_year || 'N/A' },
      { Metric: 'Report Date (IST)', Value: today },
      { Metric: '----------------------------', Value: '----------------------------' },
      { Metric: 'Total Tracked Opportunities', Value: totalOpps },
      { Metric: 'Applied Opportunities', Value: appliedOpps },
      { Metric: 'Pending Opportunities', Value: pendingOpps },
      { Metric: 'Rejected Opportunities', Value: rejectedOpps },
      { Metric: 'Application Conversion Rate', Value: `${appliedPct}%` },
      { Metric: 'Active Pending Tasks', Value: activeTasks },
      { Metric: 'Completed Tasks', Value: completedTasks }
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);

    // Sheet 2: Opportunities Detailed Breakdown
    const oppsData = opps.map(o => {
      const remaining = daysUntil(o.deadline);
      return {
        'ID': o.id,
        'Role / Title': o.title,
        'Organization': o.org || 'N/A',
        'Category': o.category ? o.category.toUpperCase() : 'OTHER',
        'Deadline': o.deadline ? formatDateIST(o.deadline) : 'Unset',
        'Raw Deadline (YYYY-MM-DD)': o.deadline || '',
        'Days Remaining': remaining !== null ? (remaining < 0 ? `Overdue by ${Math.abs(remaining)}d` : `${remaining} days`) : 'N/A',
        'Lifecycle Status': o.status ? o.status.toUpperCase() : 'PENDING',
        'Location': o.location || 'N/A',
        'Listing URL': o.url || 'N/A',
        'Created At': o.created_at
      };
    });
    const wsOpps = XLSX.utils.json_to_sheet(oppsData);

    // Sheet 3: Tasks Checklist
    const tasksData = tasks.map(t => ({
      'ID': t.id,
      'Task Description': t.title,
      'Deadline': t.deadline ? formatDateIST(t.deadline) : 'Unset',
      'Completion Status': t.done ? 'COMPLETED' : 'PENDING',
      'Created At': t.created_at
    }));
    const wsTasks = XLSX.utils.json_to_sheet(tasksData);

    // Sheet 4: Scheduled Events & Interviews
    const eventsData = events.map(e => ({
      'ID': e.id,
      'Event / Interview Title': e.title,
      'Event Date': formatDateIST(e.date),
      'Time (IST)': e.time || 'N/A',
      'Created At': e.created_at
    }));
    const wsEvents = XLSX.utils.json_to_sheet(eventsData);

    // Build Excel Workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Executive Summary');
    XLSX.utils.book_append_sheet(wb, wsOpps, 'Opportunities');
    XLSX.utils.book_append_sheet(wb, wsTasks, 'Tasks');
    XLSX.utils.book_append_sheet(wb, wsEvents, 'Events');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="Nudge_Report_${today}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('Excel Export Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. Personalized Welcome Message Endpoint
app.post('/api/welcome', (req, res) => {
  try {
    const { name = 'User', conversation_id = null } = req.body;
    const cleanName = (name && name.trim()) ? name.trim() : 'User';
    updateProfile({ name: cleanName }, req.guestId);

    let targetConvId = conversation_id;
    if (!targetConvId) {
      const convs = getConversations(req.guestId);
      targetConvId = convs.length > 0 ? convs[0].id : createConversation(req.guestId, 'General Copilot');
    }

    const welcomeText = `👋 Welcome aboard, **${cleanName}**!\n\n` +
      `Your personal **Nudge Copilot** workspace is ready. You can now:\n` +
      `• **Paste a flyer or screenshot** directly with \`Ctrl + V\`\n` +
      `• **Drop an internship or hackathon link** to extract dates and roles automatically\n` +
      `• **Type colloquially** (*"Remind me to submit my essay this Friday"*)\n` +
      `• **Ask anytime**: *"What is due this week?"*\n\n` +
      `What opportunity or deadline would you like to capture first? 🚀`;

    addMessage(targetConvId, 'bot', welcomeText, null, null, req.guestId);
    res.json({ success: true, text: welcomeText, state: getFullState(req.guestId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let server = null;
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('server.js')
);

if (isMain) {
  startScheduler();
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Nudge Copilot running at http://0.0.0.0:${PORT}`);
  });
}

export { app, server };
