/**
 * scheduler.js - Background scheduler & Web Push dispatcher using node-cron & web-push
 * With guest isolation: reminders are delivered ONLY to the owning guest's subscriptions.
 */
import cron from 'node-cron';
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  getDueReminders,
  updateReminderStatus,
  getPushSubscriptions,
  getPushSubscriptionsForGuest,
  deletePushSubscription,
  getOpportunityById
} from './db.js';
import { formatDateIST, daysUntil } from './dates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAPID_FILE = path.join(__dirname, 'data', 'vapid.json');

// Ensure VAPID keys exist
export function getOrCreateVAPIDKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
  }

  if (fs.existsSync(VAPID_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Could not read existing vapid.json, regenerating...');
    }
  }

  const keys = webpush.generateVAPIDKeys();
  const dataDir = path.dirname(VAPID_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
  return keys;
}

export const vapidKeys = getOrCreateVAPIDKeys();

const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@nudgeapp.local';

webpush.setVapidDetails(
  vapidSubject,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

/**
 * Send push notification to all stored subscriptions of a specific guest
 */
export async function sendPushToGuest(guestId, payload) {
  const subscriptions = getPushSubscriptionsForGuest(guestId);
  if (!subscriptions || subscriptions.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const payloadStr = JSON.stringify(payload);
  let sentCount = 0;
  let failedCount = 0;

  for (const sub of subscriptions) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth
      }
    };

    try {
      await webpush.sendNotification(pushSub, payloadStr);
      sentCount++;
    } catch (err) {
      failedCount++;
      console.warn(`[Push] Failed for endpoint: ${sub.endpoint.slice(0, 30)}... Code: ${err.statusCode}`);
      // Remove stale subscription on 404 or 410 Gone
      if (err.statusCode === 404 || err.statusCode === 410) {
        deletePushSubscription(sub.endpoint);
      }
    }
  }

  return { sent: sentCount, failed: failedCount };
}

/**
 * Send push notification to all stored subscriptions (backward compatibility / diagnostics)
 */
export async function sendPushToAll(payload) {
  const subscriptions = getPushSubscriptions();
  if (!subscriptions || subscriptions.length === 0) {
    console.log('[Push] No active subscriptions to dispatch push to');
    return { sent: 0, failed: 0 };
  }

  const payloadStr = JSON.stringify(payload);
  let sentCount = 0;
  let failedCount = 0;

  for (const sub of subscriptions) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth
      }
    };

    try {
      await webpush.sendNotification(pushSub, payloadStr);
      sentCount++;
    } catch (err) {
      failedCount++;
      console.warn(`[Push] Failed for endpoint: ${sub.endpoint.slice(0, 30)}... Code: ${err.statusCode}`);
      if (err.statusCode === 404 || err.statusCode === 410) {
        deletePushSubscription(sub.endpoint);
      }
    }
  }

  return { sent: sentCount, failed: failedCount };
}

/**
 * Check and process due reminders with guest isolation
 */
export async function processDueReminders() {
  const nowIso = new Date().toISOString();
  const due = getDueReminders(nowIso);

  if (due.length === 0) return;

  console.log(`[Scheduler] Found ${due.length} due reminders to dispatch`);

  for (const rem of due) {
    updateReminderStatus(rem.id, 'sending');

    let title = 'Nudge: Deadline Reminder';
    let body = 'You have an upcoming deadline!';
    let url = '/?v=opps';

    if (rem.kind === 'opportunity') {
      const opp = getOpportunityById(rem.ref_id, rem.guest_id);
      if (opp) {
        const remaining = daysUntil(opp.deadline);
        const daysText = remaining !== null ? (remaining <= 0 ? 'today' : `in ${remaining} days`) : 'soon';
        title = `Nudge: ${opp.title}`;
        body = `Deadline ${daysText} (${formatDateIST(opp.deadline)}). Do not forget to submit!`;
        url = '/?v=opps';
      }
    } else if (rem.kind === 'task') {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND guest_id = ?').get(rem.ref_id, rem.guest_id);
      if (task) {
        title = `Nudge: Task Due`;
        body = `Task "${task.title}" is due today!`;
        url = '/?v=tasks';
      }
    } else if (rem.kind === 'event') {
      const evt = db.prepare('SELECT * FROM events WHERE id = ? AND guest_id = ?').get(rem.ref_id, rem.guest_id);
      if (evt) {
        title = `Nudge: Event Reminder`;
        body = `Upcoming: ${evt.title} on ${formatDateIST(evt.date)} ${evt.time ? 'at ' + evt.time : ''}`;
        url = '/?v=events';
      }
    } else if (rem.kind === 'outreach') {
      const out = db.prepare('SELECT * FROM outreach WHERE id = ? AND guest_id = ?').get(rem.ref_id, rem.guest_id);
      if (out) {
        title = `Nudge: Outreach Follow-up`;
        body = `Follow-up with ${out.contact_name} (${out.organization || 'Outreach'}) is scheduled for today!`;
        url = '/?v=outreach';
      }
    }

    const payload = {
      title,
      body,
      url,
      tag: `rem-${rem.id}`
    };

    try {
      // Dispatch only to the guest who owns the reminder
      await sendPushToGuest(rem.guest_id || 'default_guest', payload);
      updateReminderStatus(rem.id, 'sent', new Date().toISOString());
    } catch (err) {
      console.error(`[Scheduler] Failed sending reminder ${rem.id}:`, err.message);
      updateReminderStatus(rem.id, 'failed');
    }
  }
}

let schedulerInstance = null;

/**
 * Start cron scheduler running minutely (single instance protection)
 */
export function startScheduler() {
  if (schedulerInstance) {
    return schedulerInstance;
  }

  schedulerInstance = cron.schedule('* * * * *', async () => {
    try {
      await processDueReminders();
    } catch (err) {
      console.error('[Scheduler] Error during minutely check:', err);
    }
  });

  console.log('⏰ Nudge background scheduler running (minutely checks)');
  return schedulerInstance;
}
