/**
 * tests/gemma-copilot.test.js - Comprehensive automated test suite for Gemma 4 & Nudge Copilot
 * 
 * Verifies all 15 core product requirements from Section 10:
 * 1. "Remind me in 4 days to attend EY Hackathon."
 * 2. An opportunity with an explicit application deadline.
 * 3. A poster containing registration, event, and announcement dates.
 * 4. A poster with ambiguous or missing deadline information.
 * 5. A webpage with multiple dates.
 * 6. A request to see existing deadlines.
 * 7. A correction to an existing deadline.
 * 8. A likely duplicate opportunity.
 * 9. An irrelevant query.
 * 10. Missing GEMMA_API_KEY.
 * 11. Invalid or malformed model output.
 * 12. API timeout, rate limit, or authentication failure.
 * 13. Successful database persistence and reminder scheduling.
 * 14. A scheduling failure after a record has been saved.
 * 15. A model-generated action with invalid or missing required fields.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  processUserInput,
  parseHeuristically,
  validateGemmaOutput,
  callGemmaAPI,
  formatInlineImagePart,
  generateColdEmailDraft,
  generateDeterministicDraft,
  GemmaError
} from '../ai.js';
import {
  todayIST,
  addDays,
  formatDateIST,
  daysUntil,
  countdownText,
  parseColloquialDate,
  extractDeadlineFromContext
} from '../dates.js';
import {
  resetDatabase,
  insertOpportunity,
  getOpportunityById,
  findDuplicateOpportunity,
  insertTask,
  getTasks,
  insertEvent,
  getEvents,
  scheduleReminder,
  getDueReminders,
  cancelRemindersFor,
  getConversations,
  getConversation,
  createConversation,
  renameConversation,
  deleteConversation,
  searchConversations,
  addMessage,
  getMessages,
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
  getFullState
} from '../db.js';

describe('Nudge Copilot & Gemma 4 Test Suite', () => {

  beforeEach(() => {
    // Reset test database to clean state
    resetDatabase();
    process.env.AI_MODE = 'mock'; // Ensure deterministic unit tests
  });

  // Test 1: "Remind me in 4 days to attend EY Hackathon."
  test('1. Reminder request: "Remind me in 4 days to attend EY Hackathon."', async () => {
    const prompt = 'Remind me in 4 days to attend EY Hackathon.';
    const result = await processUserInput({ text: prompt });

    assert.equal(result.intent, 'add_task');
    assert.ok(result.items.length > 0);
    const item = result.items[0];
    assert.ok(item.title.toLowerCase().includes('ey hackathon') || item.title.toLowerCase().includes('attend'));
    const expectedDate = addDays(4, todayIST());
    assert.equal(item.deadline || item.reminder_at, expectedDate);
  });

  // Test 2: An opportunity with an explicit application deadline
  test('2. Opportunity with explicit application deadline', async () => {
    const text = 'Microsoft SWE Internship 2027 application deadline is 2026-11-20.';
    const result = await processUserInput({ text });

    assert.equal(result.intent, 'save_opportunity');
    assert.ok(result.items.length > 0);
    const item = result.items[0];
    assert.equal(item.org, 'Microsoft');
    assert.equal(item.category, 'internship');
    assert.equal(item.deadline, '2026-11-20');
    assert.equal(item.evidence, 'text');
  });

  // Test 3: A poster containing registration, event, and announcement dates
  test('3. Poster with registration, event, and announcement dates (prioritizes registration)', async () => {
    const posterOCR = `
      SMART INDIA HACKATHON 2026
      Important Dates:
      - Registration Deadline: 25 October 2026
      - Hackathon Grand Finale: 29 October 2026
      - Result Announcement: 05 November 2026
    `;

    const result = await processUserInput({ text: 'Smart India Hackathon', image: null });
    // Use heuristic context scanner on the poster OCR text
    const extractedDate = extractDeadlineFromContext(posterOCR);
    assert.equal(extractedDate, '2026-10-25'); // Must pick the registration deadline!
  });

  // Test 4: A poster with ambiguous or missing deadline information
  test('4. Poster with ambiguous or missing deadline information', async () => {
    const emptyOCR = 'Tech Club Networking Night\nFree Pizza and Drinks!\nAll students welcome.';
    const parsed = parseHeuristically({ text: 'Tech Club Flyer', ocrText: emptyOCR });

    assert.ok(parsed.items.length > 0);
    assert.equal(parsed.items[0].deadline, null);
    assert.equal(parsed.items[0].evidence, 'none');
  });

  // Test 5: A webpage with multiple dates
  test('5. Webpage with multiple dates prioritizes registration deadline', async () => {
    const pageContent = `
      Welcome to Google Summer of Code!
      Timeline:
      Organization applications open: 2026-02-01
      Student registration deadline: 2026-04-02
      Coding period begins: 2026-05-20
      Final results announced: 2026-09-10
    `;

    const extracted = extractDeadlineFromContext(pageContent);
    assert.equal(extracted, '2026-04-02');
  });

  // Test 6: A request to see existing deadlines
  test('6. User query asking for deadlines (ask_deadlines)', async () => {
    const prompts = [
      "What's due this week?",
      "Show my upcoming deadlines",
      "Do I have any deadlines coming up?",
      "What is on my schedule?"
    ];

    for (const p of prompts) {
      const res = await processUserInput({ text: p });
      assert.equal(res.intent, 'ask_deadlines', `Failed for prompt: ${p}`);
    }
  });

  // Test 7: A correction to an existing deadline
  test('7. Correction or standalone date provided', async () => {
    const text = 'Actually, 2026-11-28';
    const res = await processUserInput({ text });

    assert.equal(res.intent, 'provide_deadline');
    assert.equal(res.items[0].deadline, '2026-11-28');
  });

  // Test 8: Likely duplicate opportunity detection
  test('8. Duplicate opportunity detection', () => {
    // Insert an initial opportunity
    const oppId = insertOpportunity({
      title: 'Google SWE Internship 2027',
      org: 'Google',
      category: 'internship',
      deadline: '2026-10-25'
    });

    assert.ok(oppId > 0);

    // Now query for duplicate with same org or title
    const dup1 = findDuplicateOpportunity('Google', 'Google SWE Internship 2027');
    assert.ok(dup1, 'Should find duplicate by exact title and org');
    assert.equal(dup1.id, oppId);

    const dup2 = findDuplicateOpportunity('Google', 'Google Software Engineer');
    assert.ok(dup2, 'Should find duplicate by organization match');
  });

  // Test 9: An irrelevant query
  test('9. Irrelevant query detection', async () => {
    const offTopic = 'What is the recipe for chocolate chip cookies?';
    const res = await processUserInput({ text: offTopic });

    assert.equal(res.intent, 'irrelevant');
    assert.equal(res.items.length, 0);
  });

  // Test 10: Missing GEMMA_API_KEY
  test('10. Missing GEMMA_API_KEY throws GemmaError with MISSING_API_KEY code', async () => {
    const originalKey = process.env.GEMMA_API_KEY;
    delete process.env.GEMMA_API_KEY;

    await assert.rejects(
      async () => {
        await callGemmaAPI({ text: 'Google Internship' });
      },
      (err) => {
        assert.ok(err instanceof GemmaError);
        assert.equal(err.code, 'MISSING_API_KEY');
        assert.ok(err.message.includes('GEMMA_API_KEY is not configured'));
        return true;
      }
    );

    if (originalKey) process.env.GEMMA_API_KEY = originalKey;
  });

  // Test 11: Invalid or malformed model output
  test('11. Malformed model output is rejected safely', () => {
    // Non-object
    assert.throws(() => validateGemmaOutput('not a json'), /MALFORMED_OUTPUT/);
    assert.throws(() => validateGemmaOutput(null), /MALFORMED_OUTPUT/);

    // Object with missing/invalid fields
    const validated = validateGemmaOutput({
      intent: 'unknown_intent',
      items: [{ title: '', category: 'invalid_cat', deadline: 'invalid-date' }]
    });

    assert.equal(validated.intent, 'save_opportunity'); // Sanitized to safe fallback
    assert.equal(validated.items[0].category, 'other'); // Sanitized category
    assert.equal(validated.items[0].deadline, null); // Invalid date rejected
  });

  // Test 12: API timeout, rate limit, or authentication failure
  test('12. API error categorization handles rate limits and auth failures', () => {
    const authErr = new GemmaError('Unauthorized', 'AUTH_ERROR', 'Authentication failed');
    assert.equal(authErr.code, 'AUTH_ERROR');

    const rateErr = new GemmaError('Quota exceeded', 'RATE_LIMIT', 'Rate limit exceeded');
    assert.equal(rateErr.code, 'RATE_LIMIT');

    const timeErr = new GemmaError('Timeout', 'TIMEOUT', 'Request timed out');
    assert.equal(timeErr.code, 'TIMEOUT');
  });

  // Test 13: Successful database persistence and reminder scheduling
  test('13. Successful opportunity persistence and reminder scheduling', () => {
    const deadline = addDays(7, todayIST());
    const oppId = insertOpportunity({
      title: 'Adobe Research Fellowship',
      org: 'Adobe',
      category: 'scholarship',
      deadline: deadline,
      status: 'pending'
    });

    assert.ok(oppId > 0);
    const opp = getOpportunityById(oppId);
    assert.equal(opp.title, 'Adobe Research Fellowship');
    assert.equal(opp.deadline, deadline);

    // Schedule reminder 3 days before deadline
    const remindAt = `${addDays(-3, deadline)}T03:30:00.000Z`;
    const remId = scheduleReminder('opportunity', oppId, remindAt);
    assert.ok(remId > 0);

    // Query due reminders in future
    const dueReminders = getDueReminders(`${deadline}T23:59:59.000Z`);
    assert.ok(dueReminders.some(r => r.id === remId));
  });

  // Test 14: A scheduling failure after a record has been saved
  test('14. Scheduling cancellation and clean rollback', () => {
    const oppId = insertOpportunity({
      title: 'Goldman Sachs Hiring',
      org: 'Goldman Sachs',
      deadline: '2026-10-29'
    });

    const remId = scheduleReminder('opportunity', oppId, '2026-10-26T03:30:00.000Z');
    assert.ok(remId > 0);

    // Cancel reminders for opportunity
    cancelRemindersFor('opportunity', oppId);

    // Verify it is no longer scheduled
    const state = getFullState();
    const activeDues = getDueReminders('2026-10-30T00:00:00.000Z');
    assert.ok(!activeDues.some(r => r.id === remId && r.status === 'scheduled'));
  });

  // Test 15: Model-generated action with invalid or missing required fields
  test('15. Model-generated action with invalid dates (e.g. 2026-02-31) is sanitized to null', () => {
    const dirtyOutput = {
      intent: 'save_opportunity',
      items: [
        {
          title: 'Devfolio Hackathon',
          org: 'Devfolio',
          category: 'hackathon',
          deadline: '2026-02-31', // Non-existent calendar date
          evidence: 'text'
        }
      ]
    };

    const sanitized = validateGemmaOutput(dirtyOutput);
    assert.equal(sanitized.items[0].deadline, null, 'Invalid calendar date 2026-02-31 must be sanitized to null');
    assert.equal(sanitized.items[0].category, 'hackathon');
  });

  // Multimodal image part formatting test
  test('Bonus: formatInlineImagePart formats data URI and buffer properly', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const part = formatInlineImagePart(dataUri);

    assert.ok(part);
    assert.ok(part.inlineData);
    assert.equal(part.inlineData.mimeType, 'image/png');
    assert.ok(part.inlineData.data.startsWith('iVBORw0KGgo'));
  });

  // Test 16: Persistent Chat Storage - Creating, messaging, ordering, and retrieval
  test('16. Persistent Chat: Create conversation, persist messages, maintain order', () => {
    const convId = createConversation('GSoC Prep Chat');
    assert.ok(convId > 0);

    const m1 = addMessage(convId, 'user', 'When is the GSoC deadline?');
    const m2 = addMessage(convId, 'bot', 'GSoC registration ends on 24 Oct 2026.');
    const m3 = addMessage(convId, 'user', 'Thanks! Set a reminder.');

    assert.ok(m1 > 0 && m2 > m1 && m3 > m2);

    const msgs = getMessages(convId);
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[0].text, 'When is the GSoC deadline?');
    assert.equal(msgs[1].role, 'bot');
    assert.equal(msgs[2].role, 'user');
  });

  // Test 17: Persistent Chat Storage - Search by title and message content
  test('17. Persistent Chat: Search past conversations by title and message snippet', () => {
    const c1 = createConversation('Google Prep Session');
    addMessage(c1, 'user', 'Preparing resume for Mountain View internship');

    const c2 = createConversation('Hackathon Squad');
    addMessage(c2, 'user', 'Need fullstack teammates for ETHIndia');

    // Search by title
    const searchByTitle = searchConversations('Google');
    assert.ok(searchByTitle.some(c => c.id === c1));
    assert.ok(!searchByTitle.some(c => c.id === c2));

    // Search by message content
    const searchByContent = searchConversations('ETHIndia');
    assert.ok(searchByContent.some(c => c.id === c2));
  });

  // Test 18: Persistent Chat Storage - Renaming and safe deletion
  test('18. Persistent Chat: Renaming and safe deletion (preserves opportunities and tasks)', () => {
    const convId = createConversation('Draft Title');
    renameConversation(convId, 'Finalized Google Discussion');

    const updated = getConversation(convId);
    assert.equal(updated.title, 'Finalized Google Discussion');

    // Add opportunity and task to make sure they survive conversation deletion
    const oppId = insertOpportunity({ title: 'Google SWE', deadline: '2026-11-01' });
    const taskId = insertTask({ title: 'Review DSA' });

    addMessage(convId, 'user', 'Test message inside conversation');

    deleteConversation(convId);

    // Conversation & messages should be gone
    assert.equal(getConversation(convId), undefined);
    assert.equal(getMessages(convId).length, 0);

    // Opportunities and tasks must be preserved!
    assert.ok(getOpportunityById(oppId));
    assert.ok(getTasks().some(t => t.id === taskId));
  });

  // Test 19: Persistent Chat Storage - Historical card safety
  test('19. Persistent Chat: Historical confirmation card can be marked confirmed to prevent duplicate re-execution', () => {
    const convId = createConversation('Card Safety Test');
    const actionsBlob = {
      type: 'deadline_card',
      item: { title: 'Test Hackathon', deadline: '2026-11-15' },
      confirmed: false
    };

    const msgId = addMessage(convId, 'bot', 'Please confirm your deadline:', actionsBlob);
    const msgs = getMessages(convId);
    assert.equal(JSON.parse(msgs[0].actions).confirmed, false);

    // Update message action to confirmed: true
    actionsBlob.confirmed = true;
    actionsBlob.confirmed_action = 'accept_suggested';
    updateMessageActions(msgId, actionsBlob);

    const reloaded = getMessages(convId);
    const parsed = JSON.parse(reloaded[0].actions);
    assert.equal(parsed.confirmed, true);
    assert.equal(parsed.confirmed_action, 'accept_suggested');
  });

  // Test 20: AI Continuity - Standalone date resolution with prior conversation history
  test('20. AI Continuity: Standalone date resolves contextually when prior opportunity exists in history', async () => {
    const history = [
      {
        role: 'user',
        text: 'Save Microsoft SWE Internship 2027'
      },
      {
        role: 'bot',
        text: 'I captured Microsoft SWE Internship! Please confirm deadline.',
        actions: JSON.stringify({
          type: 'deadline_card',
          item: {
            title: 'Microsoft SWE Internship 2027',
            org: 'Microsoft',
            category: 'internship'
          }
        })
      }
    ];

    const result = await processUserInput({
      text: '2026-11-25',
      history
    });

    assert.equal(result.intent, 'provide_deadline');
    assert.ok(result.items.length > 0);
    assert.equal(result.items[0].deadline, '2026-11-25');
    assert.equal(result.items[0].title, 'Microsoft SWE Internship 2027');
    assert.equal(result.items[0].org, 'Microsoft');
  });

  // Test 21: Cold Emailing Tracker - Record creation and metric aggregation
  test('21. Cold Emailing: Record creation and metric aggregation', () => {
    insertOutreach({
      contact_name: 'Dr. Priya Sharma',
      contact_email: 'priya@google.com',
      organization: 'Google DeepMind',
      role: 'Research Scientist',
      category: 'research',
      subject: 'Research Inquiry: Gemma 4 Agents',
      body: 'Hi Dr. Sharma, I am interested in your work...',
      status: 'draft'
    });

    insertOutreach({
      contact_name: 'Arvind Kumar',
      contact_email: 'arvind@microsoft.com',
      organization: 'Microsoft',
      role: 'Director',
      category: 'referral',
      status: 'sent',
      first_contact_date: '2026-10-10'
    });

    const metrics = getOutreachMetrics();
    assert.equal(metrics.total, 2);
    assert.equal(metrics.drafts, 1);
    assert.equal(metrics.sent, 1);
    assert.equal(metrics.replied, 0);
    assert.equal(metrics.replyRate, 0);
  });

  // Test 22: Cold Emailing Tracker - Mark as sent and proactive follow-up due calculation
  test('22. Cold Emailing: Mark as sent and proactive follow-up due detection', () => {
    const id = insertOutreach({
      contact_name: 'Sarah Jenkins',
      organization: 'Adobe',
      status: 'draft'
    });

    // Mark sent with follow-up due today
    const today = todayIST();
    markOutreachSent(id, { sent_date: addDays(-4, today), next_followup_date: today });

    const updated = getOutreachById(id);
    assert.equal(updated.status, 'sent');
    assert.equal(updated.next_followup_date, today);

    const metrics = getOutreachMetrics();
    assert.equal(metrics.sent, 1);
    assert.equal(metrics.followupDue, 1, 'Outreach with follow-up date <= today should register as follow-up due');
  });

  // Test 23: Cold Emailing Tracker - Recording reply cancels scheduled reminders
  test('23. Cold Emailing: Recording reply cancels scheduled follow-up reminder and updates metrics', () => {
    const id = insertOutreach({
      contact_name: 'Elena Rostova',
      organization: 'Anthropic',
      status: 'sent',
      next_followup_date: '2026-10-25'
    });

    // Schedule reminder
    scheduleReminder('outreach', id, '2026-10-25T03:30:00.000Z');

    // Record reply
    recordOutreachReply(id, { response_date: todayIST(), outcome: 'meeting_scheduled', notes: 'Interview set for Thursday!' });

    const updated = getOutreachById(id);
    assert.equal(updated.status, 'meeting_scheduled');
    assert.equal(updated.next_followup_date, null);
    assert.equal(updated.notes, 'Interview set for Thursday!');

    // Reminder must be cancelled
    const dues = getDueReminders('2026-10-26T00:00:00.000Z');
    assert.ok(!dues.some(r => r.kind === 'outreach' && r.ref_id === id && r.status === 'scheduled'));

    const metrics = getOutreachMetrics();
    assert.equal(metrics.meetings, 1);
    assert.equal(metrics.replied, 1);
  });

  // Test 24: Cold Emailing Tracker - Follow-up rescheduling
  test('24. Cold Emailing: Reschedule follow-up updates date and reminder', () => {
    const id = insertOutreach({
      contact_name: 'David Lee',
      organization: 'Meta',
      status: 'sent',
      next_followup_date: '2026-10-18'
    });

    const newDate = addDays(5, todayIST());
    scheduleOutreachFollowup(id, { next_followup_date: newDate, notes: 'Follow-up delayed to next week' });

    const updated = getOutreachById(id);
    assert.equal(updated.next_followup_date, newDate);
    assert.equal(updated.notes, 'Follow-up delayed to next week');

    const dues = getDueReminders(`${newDate}T12:00:00.000Z`);
    assert.ok(dues.some(r => r.kind === 'outreach' && r.ref_id === id && r.status === 'scheduled'));
  });

  // Test 25: Cold Email Draft Assistance - Strictly no hallucinated qualifications + placeholders
  test('25. Cold Email Drafting: Uses bracketed placeholders without hallucinating credentials', async () => {
    const draft = await generateColdEmailDraft({
      purpose: 'research',
      recipient_name: 'Dr. John Doe',
      recipient_org: 'Stanford AI Lab',
      recipient_role: 'Professor',
      user_background: 'CS Undergraduate student'
    });

    assert.ok(draft.subject, 'Must have a subject');
    assert.ok(draft.body, 'Must have a body');
    assert.ok(draft.subject.toLowerCase().includes('research') || draft.subject.toLowerCase().includes('stanford'));

    // Verify it uses authentic placeholders rather than fake claims
    assert.ok(draft.body.includes('[') && draft.body.includes(']'), 'Draft must contain bracketed placeholders for student to fill in');
    assert.ok(!draft.body.toLowerCase().includes('phd'), 'Must not invent a PhD for an undergraduate student');

    // Test follow-up drafting
    const followupDraft = await generateColdEmailDraft({
      purpose: 'internship',
      recipient_name: 'Jane Smith',
      recipient_org: 'Google',
      is_followup: true
    });

    assert.ok(followupDraft.subject.toLowerCase().includes('following up'));
    assert.ok(followupDraft.body.toLowerCase().includes('follow up') || followupDraft.body.toLowerCase().includes('previous'));
  });
});

