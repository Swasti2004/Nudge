/**
 * server.js - Express backend for Nudge Copilot
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';

dotenv.config();

import {
  db,
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
  insertPushSubscription,
  getConversations,
  getConversation,
  createConversation,
  updateConversationPending,
  getMessages,
  addMessage,
  getFullState,
  resetDatabase,
  seedDatabase
} from './db.js';

import { processUserInput } from './ai.js';
import { todayIST, formatDateIST, daysUntil, countdownText, addDays } from './dates.js';
import { vapidKeys, startScheduler, sendPushToAll } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend files
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Schedule automated reminders for an opportunity based on deadline
 */
function scheduleOppReminders(oppId, deadlineStr, leadDays = 3) {
  if (!deadlineStr) return;
  const days = daysUntil(deadlineStr);
  const today = todayIST();

  let remindDateStr = addDays(-leadDays, deadlineStr);
  // If reminder date would be in the past or today, set for today
  if (days <= leadDays) {
    remindDateStr = today;
  }

  // 9:00 AM IST = 03:30 UTC
  const remindAtIso = `${remindDateStr}T03:30:00.000Z`;
  scheduleReminder('opportunity', oppId, remindAtIso);
}

/* ============================================================
   REST API Endpoints
   ============================================================ */

// 1. Full state
app.get('/api/state', (req, res) => {
  try {
    const state = getFullState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Chat history for a conversation
app.get('/api/chat/:convId/messages', (req, res) => {
  try {
    const convId = parseInt(req.params.convId, 10);
    const msgs = getMessages(convId);
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Conversations list / create
app.get('/api/conversations', (req, res) => {
  try {
    res.json(getConversations());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversations', (req, res) => {
  try {
    const title = req.body.title || 'New Copilot Chat';
    const id = createConversation(title);
    res.json({ id, title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Post chat message
app.post('/api/chat', async (req, res) => {
  try {
    let { conversation_id, text = '', image = null } = req.body;

    if (!conversation_id) {
      const convs = getConversations();
      conversation_id = convs.length > 0 ? convs[0].id : createConversation();
    }

    if (!text && !image) {
      return res.status(400).json({ error: 'Message text or image is required' });
    }

    // Persist user message
    addMessage(conversation_id, 'user', text, null, image ? 'uploaded_poster.png' : null);

    // Run AI Extraction pipeline
    const aiResult = await processUserInput({ text, image });
    const { intent, items = [] } = aiResult;

    // Handle Intent 1: ask_deadlines
    if (intent === 'ask_deadlines') {
      const opps = getOpportunities('pending');
      const tasks = getTasks().filter(t => !t.done);
      const events = getEvents();

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

      addMessage(conversation_id, 'bot', reply);
      return res.json({
        role: 'bot',
        text: reply,
        actions: null,
        state: getFullState()
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

      addMessage(conversation_id, 'bot', reply);
      return res.json({
        role: 'bot',
        text: reply,
        actions: null,
        state: getFullState()
      });
    }

    // Handle Intent 3: add_event
    if (intent === 'add_event' && items.length > 0) {
      const item = items[0];
      const eventDate = item.deadline || todayIST();
      const eventId = insertEvent({
        title: item.title,
        date: eventDate,
        time: item.time || null
      });

      const reply = `✅ Added **${item.title}** to your events calendar for **${formatDateIST(eventDate)}** ${item.time ? 'at ' + item.time : ''}.`;
      addMessage(conversation_id, 'bot', reply);
      return res.json({
        role: 'bot',
        text: reply,
        actions: null,
        state: getFullState()
      });
    }

    // Handle Intent 4: save_opportunity or add_task or extracted items
    if (items.length > 0) {
      const item = items[0];

      // Check for duplicate opportunity
      const duplicate = findDuplicateOpportunity(item.org, item.title);
      if (duplicate) {
        // Halt and prompt duplicate verification card
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

        addMessage(conversation_id, 'bot', reply, actions);
        return res.json({
          role: 'bot',
          text: reply,
          actions,
          state: getFullState()
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

      addMessage(conversation_id, 'bot', reply, actions);
      return res.json({
        role: 'bot',
        text: reply,
        actions,
        state: getFullState()
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

    addMessage(conversation_id, 'bot', reply);
    return res.json({
      role: 'bot',
      text: reply,
      actions: null,
      state: getFullState()
    });

  } catch (err) {
    console.error('Error in /api/chat:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Handle card interactive actions
app.post('/api/action', (req, res) => {
  try {
    const { action, payload, conversation_id } = req.body;

    let botReply = '';
    let updatedItem = null;

    if (action === 'accept_suggested') {
      // 1-click accept of extracted date
      const oppId = insertOpportunity({
        title: payload.title,
        org: payload.org || null,
        category: payload.category || 'other',
        deadline: payload.deadline,
        location: payload.location || null,
        url: payload.url || null,
        status: 'pending'
      });

      scheduleOppReminders(oppId, payload.deadline);
      updatedItem = getOpportunityById(oppId);
      botReply = `✅ Saved **${payload.title}**! Deadline confirmed for **${formatDateIST(payload.deadline)}** (${countdownText(payload.deadline)}). Proactive reminders are scheduled! 🚀`;
    }

    else if (action === 'set_manual') {
      // Custom date confirmed
      const oppId = insertOpportunity({
        title: payload.title,
        org: payload.org || null,
        category: payload.category || 'other',
        deadline: payload.deadline,
        location: payload.location || null,
        url: payload.url || null,
        status: 'pending'
      });

      scheduleOppReminders(oppId, payload.deadline);
      updatedItem = getOpportunityById(oppId);
      botReply = `✅ Saved **${payload.title}** with custom deadline **${formatDateIST(payload.deadline)}** (${countdownText(payload.deadline)}). We will nudge you before it's due! 🚀`;
    }

    else if (action === 'dup_update') {
      // Update existing record
      updateOpportunity(payload.existingId, {
        deadline: payload.deadline,
        status: 'pending'
      });
      scheduleOppReminders(payload.existingId, payload.deadline);
      updatedItem = getOpportunityById(payload.existingId);
      botReply = `🔄 Updated existing entry **${updatedItem.title}**! New deadline is **${formatDateIST(payload.deadline)}** and status has been reset to **Pending**.`;
    }

    else if (action === 'dup_add_anyway') {
      // Add separate new entry
      const oppId = insertOpportunity({
        title: payload.title,
        org: payload.org || null,
        category: payload.category || 'other',
        deadline: payload.deadline,
        location: payload.location || null,
        url: payload.url || null,
        status: 'pending'
      });
      scheduleOppReminders(oppId, payload.deadline);
      updatedItem = getOpportunityById(oppId);
      botReply = `➕ Added **${payload.title}** as a separate new entry with deadline **${formatDateIST(payload.deadline)}**.`;
    }

    else if (action === 'dup_cancel') {
      botReply = `👌 Kept existing record unchanged. Discarded the duplicate entry.`;
    }

    else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    if (conversation_id && botReply) {
      addMessage(conversation_id, 'bot', botReply);
    }

    res.json({
      success: true,
      botReply,
      item: updatedItem,
      state: getFullState()
    });

  } catch (err) {
    console.error('Error in /api/action:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Opportunities endpoints
app.get('/api/opportunities', (req, res) => {
  try {
    const { status } = req.query;
    res.json(getOpportunities(status));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/opportunities', (req, res) => {
  try {
    const { title, org, category, deadline, location, url, status } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const id = insertOpportunity({ title, org, category, deadline, location, url, status });
    if (deadline) scheduleOppReminders(id, deadline);
    res.json(getOpportunityById(id));
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
    const updated = updateOpportunityStatus(id, status);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/opportunities/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    deleteOpportunity(id);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/opportunities', (req, res) => {
  try {
    clearOpportunities();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Tasks endpoints
app.get('/api/tasks', (req, res) => {
  try {
    res.json(getTasks());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const { title, deadline } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const id = insertTask({ title, deadline });
    res.json({ id, title, deadline, done: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/:id/done', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = toggleTaskDone(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    deleteTask(id);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Events endpoints
app.get('/api/events', (req, res) => {
  try {
    res.json(getEvents());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events', (req, res) => {
  try {
    const { title, date, time } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'Title and date are required' });
    const id = insertEvent({ title, date, time });
    res.json({ id, title, date, time });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/events/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    deleteEvent(id);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Profile endpoints
app.get('/api/profile', (req, res) => {
  try {
    res.json(getProfile());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    const updated = updateProfile(req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Seed & Reset
app.post('/api/seed', (req, res) => {
  try {
    seedDatabase();
    res.json({ success: true, state: getFullState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', (req, res) => {
  try {
    resetDatabase();
    res.json({ success: true, state: getFullState() });
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
    insertPushSubscription(endpoint, keys.p256dh, keys.auth);
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
    const result = await sendPushToAll(payload);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Export Reports and Data to Excel (.xlsx)
app.get('/api/export/excel', (req, res) => {
  try {
    const opps = getOpportunities();
    const tasks = getTasks();
    const events = getEvents();
    const profile = getProfile();
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
    const { name = 'User', conversation_id = 1 } = req.body;
    const cleanName = (name && name.trim()) ? name.trim() : 'User';
    updateProfile({ name: cleanName });

    const welcomeText = `👋 Welcome aboard, **${cleanName}**!\n\n` +
      `Your personal **Nudge Copilot** workspace is ready. You can now:\n` +
      `• **Paste a flyer or screenshot** directly with \`Ctrl + V\`\n` +
      `• **Drop an internship or hackathon link** to extract dates and roles automatically\n` +
      `• **Type colloquially** (*"Remind me to submit my essay this Friday"*)\n` +
      `• **Ask anytime**: *"What is due this week?"*\n\n` +
      `What opportunity or deadline would you like to capture first? 🚀`;

    addMessage(conversation_id, 'bot', welcomeText);
    res.json({ success: true, text: welcomeText, state: getFullState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start background cron scheduler
startScheduler();

// Start HTTP server on 0.0.0.0:3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Nudge Copilot running at http://0.0.0.0:${PORT}`);
});
