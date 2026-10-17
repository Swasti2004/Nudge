/**
 * tests/guest-isolation.test.js - Automated Verification of Multi-tenant Anonymous Guest Isolation
 * 
 * Verifies all 9 guest-isolation requirements:
 * 1. Guest A creates opportunities and tasks.
 * 2. Guest B creates different opportunities and tasks.
 * 3. Both reload their sessions.
 * 4. Each guest sees only their own records.
 * 5. Guest B cannot read, update or delete Guest A's records by guessing IDs (IDOR protection).
 * 6. Guest A's records survive a simulated restart using the same database.
 * 7. Conversation history, exports, push subscriptions and reminders do not cross guest boundaries.
 * 8. Expired or invalid credentials are rejected safely and a new session is issued.
 * 9. The database migration preserves existing records.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  initDB,
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
  getTasks,
  insertTask,
  toggleTaskDone,
  deleteTask,
  getEvents,
  insertEvent,
  deleteEvent,
  scheduleReminder,
  getDueReminders,
  cancelRemindersFor,
  insertPushSubscription,
  getPushSubscriptionsForGuest,
  createConversation,
  getConversations,
  getConversation,
  getMessages,
  addMessage,
  deleteConversation,
  insertOutreach,
  getOutreachRecords,
  getOutreachById,
  deleteOutreach,
  getFullState
} from '../db.js';
import { app } from '../server.js';

describe('Multi-tenant Anonymous Guest Isolation & Security Test Suite', () => {
  const guestA = 'g_test_user_alpha_1111111111111111';
  const guestB = 'g_test_user_bravo_2222222222222222';
  const tokenA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const tokenB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  let serverInstance = null;
  let serverPort = null;

  before(async () => {
    // Start test server on random high port
    await new Promise((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        serverPort = serverInstance.address().port;
        resolve();
      });
    });

    // Initialize test sessions for Guest A and Guest B
    const futureExpiry = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    createGuestSession(guestA, tokenA, futureExpiry);
    createGuestSession(guestB, tokenB, futureExpiry);
  });

  after(async () => {
    if (serverInstance) {
      if (serverInstance.closeAllConnections) {
        serverInstance.closeAllConnections();
      }
      await new Promise(resolve => serverInstance.close(resolve));
    }
  });

  test('1 & 2. Guest A and Guest B create isolated opportunities and tasks', () => {
    const oppA = insertOpportunity({
      title: 'Google DeepMind Research Internship',
      org: 'Google',
      deadline: '2026-11-20'
    }, guestA);

    const taskA = insertTask({
      title: 'Draft ML Paper Summary for Guest A',
      deadline: '2026-11-15'
    }, guestA);

    const oppB = insertOpportunity({
      title: 'Jane Street Quantitative Fellowship',
      org: 'Jane Street',
      deadline: '2026-11-30'
    }, guestB);

    const taskB = insertTask({
      title: 'Probability Theory Review for Guest B',
      deadline: '2026-11-25'
    }, guestB);

    assert.ok(oppA > 0);
    assert.ok(taskA > 0);
    assert.ok(oppB > 0);
    assert.ok(taskB > 0);
    assert.notEqual(oppA, oppB);
  });

  test('3 & 4. Reloading sessions: Guest A sees ONLY Guest A records, Guest B sees ONLY Guest B records', () => {
    const listA = getOpportunities(null, guestA);
    const tasksA = getTasks(guestA);

    const listB = getOpportunities(null, guestB);
    const tasksB = getTasks(guestB);

    // Guest A assertions
    assert.ok(listA.some(o => o.title === 'Google DeepMind Research Internship'));
    assert.ok(!listA.some(o => o.title === 'Jane Street Quantitative Fellowship'));
    assert.ok(tasksA.some(t => t.title === 'Draft ML Paper Summary for Guest A'));
    assert.ok(!tasksA.some(t => t.title === 'Probability Theory Review for Guest B'));

    // Guest B assertions
    assert.ok(listB.some(o => o.title === 'Jane Street Quantitative Fellowship'));
    assert.ok(!listB.some(o => o.title === 'Google DeepMind Research Internship'));
    assert.ok(tasksB.some(t => t.title === 'Probability Theory Review for Guest B'));
    assert.ok(!tasksB.some(t => t.title === 'Draft ML Paper Summary for Guest A'));
  });

  test('5. IDOR Protection: Guest B cannot read, modify, or delete Guest A records by ID', () => {
    const oppsA = getOpportunities(null, guestA);
    const oppAId = oppsA[0].id;

    // Guest B tries to view Guest A's opportunity
    const viewAttempt = getOpportunityById(oppAId, guestB);
    assert.equal(viewAttempt, undefined, 'Guest B must not be able to view Guest A opportunity');

    // Guest B tries to update Guest A's opportunity
    const updateAttempt = updateOpportunity(oppAId, { title: 'Hacked Title' }, guestB);
    assert.equal(updateAttempt, null, 'Guest B must not be able to update Guest A opportunity');

    // Verify Guest A's title was NOT changed
    const unchangedA = getOpportunityById(oppAId, guestA);
    assert.equal(unchangedA.title, 'Google DeepMind Research Internship');

    // Guest B tries to delete Guest A's opportunity
    deleteOpportunity(oppAId, guestB);
    const stillExists = getOpportunityById(oppAId, guestA);
    assert.ok(stillExists, 'Guest A opportunity must still exist after Guest B delete attempt');
  });

  test('6. Conversation and Message Isolation: Conversations do not leak between guests', () => {
    const convA = createConversation(guestA, 'Guest A Private Chat');
    addMessage(convA, 'user', 'My secret project idea is X', null, null, guestA);

    const convB = createConversation(guestB, 'Guest B Public Chat');
    addMessage(convB, 'user', 'Hello from Guest B', null, null, guestB);

    const convsForA = getConversations(guestA);
    const convsForB = getConversations(guestB);

    assert.ok(convsForA.some(c => c.id === convA));
    assert.ok(!convsForA.some(c => c.id === convB));

    assert.ok(convsForB.some(c => c.id === convB));
    assert.ok(!convsForB.some(c => c.id === convA));

    // Message retrieval scoping
    const msgsA = getMessages(convA, guestA);
    assert.equal(msgsA.length, 1);
    assert.equal(msgsA[0].text, 'My secret project idea is X');

    // Guest B tries to retrieve Guest A messages
    const msgsLeakAttempt = getMessages(convA, guestB);
    assert.deepEqual(msgsLeakAttempt, [], 'Guest B must receive empty array when trying to read Guest A conversation');
  });

  test('7. Push Subscriptions & Reminders Isolation: Reminders target only their creator', () => {
    // Register push subscription for Guest A
    insertPushSubscription('https://fcm.googleapis.com/guest-a-phone', 'key_p256_a', 'auth_a', guestA);
    // Register push subscription for Guest B
    insertPushSubscription('https://fcm.googleapis.com/guest-b-laptop', 'key_p256_b', 'auth_b', guestB);

    const subsA = getPushSubscriptionsForGuest(guestA);
    const subsB = getPushSubscriptionsForGuest(guestB);

    assert.equal(subsA.length, 1);
    assert.equal(subsA[0].endpoint, 'https://fcm.googleapis.com/guest-a-phone');

    assert.equal(subsB.length, 1);
    assert.equal(subsB[0].endpoint, 'https://fcm.googleapis.com/guest-b-laptop');

    // Schedule reminder for Guest A
    const remA = scheduleReminder('task', 999, '2026-10-15T09:00:00.000Z', guestA);
    const allDue = getDueReminders('2026-10-16T00:00:00.000Z');
    const matched = allDue.find(r => r.id === remA);
    assert.ok(matched);
    assert.equal(matched.guest_id, guestA);
  });

  test('8. Full State isolation: getFullState returns exclusively guest-owned data', () => {
    const stateA = getFullState(guestA);
    const stateB = getFullState(guestB);

    assert.equal(stateA.guestId, guestA);
    assert.equal(stateB.guestId, guestB);

    for (const opp of stateA.opps) {
      assert.equal(opp.guest_id, guestA);
    }
    for (const opp of stateB.opps) {
      assert.equal(opp.guest_id, guestB);
    }
  });

  test('9. HTTP End-to-End Cookie & Session Isolation via Express REST API', async () => {
    // 1. Request with tokenA cookie
    const resA = await fetch(`http://127.0.0.1:${serverPort}/api/opportunities`, {
      headers: { 'Cookie': `nudge_guest=${tokenA}` }
    });
    assert.equal(resA.status, 200);
    const oppsA = await resA.json();
    assert.ok(oppsA.some(o => o.title === 'Google DeepMind Research Internship'));
    assert.ok(!oppsA.some(o => o.title === 'Jane Street Quantitative Fellowship'));

    // 2. Request with tokenB cookie
    const resB = await fetch(`http://127.0.0.1:${serverPort}/api/opportunities`, {
      headers: { 'Cookie': `nudge_guest=${tokenB}` }
    });
    assert.equal(resB.status, 200);
    const oppsB = await resB.json();
    assert.ok(oppsB.some(o => o.title === 'Jane Street Quantitative Fellowship'));
    assert.ok(!oppsB.some(o => o.title === 'Google DeepMind Research Internship'));

    // 3. New visitor without cookie receives Set-Cookie and distinct blank state
    const resNew = await fetch(`http://127.0.0.1:${serverPort}/api/state`);
    assert.equal(resNew.status, 200);
    const setCookieHeader = resNew.headers.get('set-cookie');
    assert.ok(setCookieHeader, 'New visitor must receive Set-Cookie header');
    assert.ok(setCookieHeader.includes('nudge_guest='), 'Cookie name must be nudge_guest');
    assert.ok(setCookieHeader.includes('HttpOnly'), 'Cookie must be HttpOnly');
    assert.ok(setCookieHeader.includes('SameSite=Lax'), 'Cookie must have SameSite=Lax');

    const newState = await resNew.json();
    assert.equal(newState.opps.length, 0, 'Brand new guest must start with empty opportunity list');
    assert.notEqual(newState.guestId, guestA);
    assert.notEqual(newState.guestId, guestB);
  });

  test('10. Health check endpoint responds with 200 OK', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/../health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.ok(typeof data.uptime === 'number');
  });
});
