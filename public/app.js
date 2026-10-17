/**
 * app.js - Nudge Frontend Single Page Application
 * Zero build-step, vanilla ES6+, reactive state S
 */

// Global Reactive State
const S = {
  view: 'chat', // 'chat' | 'opps' | 'outreach' | 'reports' | 'tasks' | 'events' | 'cal' | 'soon' | 'set'
  convId: null,
  convs: [],
  msgs: [],
  opps: [],
  tasks: [],
  events: [],
  outreach: [],
  outreachMetrics: {},
  outreachFilter: 'all',
  outreachSearch: '',
  chatDrawerOpen: localStorage.getItem('nudge_chat_drawer_open') !== 'false',
  sidebarCollapsed: localStorage.getItem('nudge_sidebar_collapsed') === 'true',
  profile: {
    name: 'User',
    goal: 'Internships & Jobs',
    college: '',
    major: '',
    grad_year: '',
    target_role: 'Student',
    email: ''
  },
  lead: 3,
  nudgeTime: '9:00 AM IST (Morning)',
  sound: true,
  theme: 'dark',
  filterStatus: 'all',
  reportPeriod: 'month', // 'month' | 'week'
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(), // 0-indexed
  currentUploadImage: null,
  isSending: false
};

/* ==========================================================================
   Sound & Web Audio API
   ========================================================================== */
function playChime() {
  if (!S.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch (e) {
    console.warn('Audio chime error:', e);
  }
}

/* ==========================================================================
   Date Helpers (IST Aware)
   ========================================================================== */
function todayIST() {
  const d = new Date(Date.now() + 5.5 * 3600000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'No Date';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[month]} ${year}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = todayIST();
  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = dateStr.split('-').map(Number);
  const dt1 = new Date(Date.UTC(y1, m1 - 1, d1));
  const dt2 = new Date(Date.UTC(y2, m2 - 1, d2));
  return Math.round((dt2 - dt1) / (1000 * 3600 * 24));
}

function countdownText(dateStr) {
  const diff = daysUntil(dateStr);
  if (diff === null) return '';
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < -1) return `Overdue by ${Math.abs(diff)}d`;
  return `In ${diff} days`;
}

function addDays(days, baseDateStr = null) {
  const base = baseDateStr || todayIST();
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(dt.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

/* ==========================================================================
   Toast Notifications
   ========================================================================== */
function showToast(text, icon = '🔔', duration = 3200) {
  const toast = document.getElementById('toast');
  const iconEl = document.getElementById('toast-icon');
  const textEl = document.getElementById('toast-text');
  if (!toast) return;

  iconEl.textContent = icon;
  textEl.textContent = text;
  toast.style.display = 'flex';

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

/* ==========================================================================
   API Calls & Sync
   ========================================================================== */
async function fetchState() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('Failed to load state');
    const data = await res.json();
    S.profile = data.profile || S.profile;
    S.opps = data.opps || [];
    S.tasks = data.tasks || [];
    S.events = data.events || [];
    S.convs = data.convs || [];
    S.outreach = data.outreach || [];
    S.outreachMetrics = data.outreachMetrics || {};

    if (!S.convId && S.convs.length > 0) {
      S.convId = S.convs[0].id;
    }

    if (S.convId) {
      await fetchMessages(S.convId);
    }

    updateSidebarProfile();
    updateBadges();
    renderActiveView();
  } catch (err) {
    console.error('fetchState error:', err);
    showToast('Failed to sync state from server', '⚠️');
  }
}

async function fetchMessages(convId) {
  try {
    const res = await fetch(`/api/chat/${convId}/messages`);
    if (res.ok) {
      S.msgs = await res.json();
    }
  } catch (err) {
    console.error('fetchMessages error:', err);
  }
}

function updateSidebarProfile() {
  const nameEl = document.getElementById('sidebar-user-name');
  const goalEl = document.getElementById('sidebar-user-goal');
  const avatarEl = document.getElementById('sidebar-user-avatar');

  if (nameEl) nameEl.textContent = S.profile.name || 'User Profile';
  if (goalEl) goalEl.textContent = S.profile.goal || 'Internships & Jobs';

  if (avatarEl) {
    const initials = (S.profile.name || 'U')
      .split(' ')
      .map(p => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    avatarEl.textContent = initials || 'U';
  }
}

function updateBadges() {
  const pendingOpps = S.opps.filter(o => o.status === 'pending').length;
  const activeTasks = S.tasks.filter(t => !t.done).length;
  const eventsCount = S.events.length;
  const soonCount = S.opps.filter(o => {
    if (o.status !== 'pending' || !o.deadline) return false;
    const diff = daysUntil(o.deadline);
    return diff !== null && diff <= 7 && diff >= 0;
  }).length;
  const outreachDue = S.outreachMetrics?.followupDue || 0;

  const bOpps = document.getElementById('badge-opps');
  const bTasks = document.getElementById('badge-tasks');
  const bEvents = document.getElementById('badge-events');
  const bSoon = document.getElementById('badge-soon');
  const bOutreach = document.getElementById('badge-outreach');

  if (bOpps) bOpps.textContent = pendingOpps;
  if (bTasks) bTasks.textContent = activeTasks;
  if (bEvents) bEvents.textContent = eventsCount;
  if (bSoon) bSoon.textContent = soonCount;
  if (bOutreach) bOutreach.textContent = outreachDue;
}

/* ==========================================================================
   Navigation & View Routing
   ========================================================================== */
function setView(viewName) {
  S.view = viewName;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });
  renderActiveView();
}

function renderActiveView() {
  const root = document.getElementById('view-content-root');
  const titleEl = document.getElementById('view-title');
  const subEl = document.getElementById('view-subtitle');
  const actionsEl = document.getElementById('view-actions');

  if (!root) return;

  root.classList.toggle('chat-view-active', S.view === 'chat');

  switch (S.view) {
    case 'chat':
      titleEl.textContent = 'Copilot Assistant';
      subEl.textContent = 'Drop any link, poster flyer, or colloquial text to capture deadlines';
      actionsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm ${S.chatDrawerOpen ? 'active' : ''}" id="btn-toggle-chat-drawer" title="${S.chatDrawerOpen ? 'Collapse conversations sidebar (reserve space)' : 'Expand conversations sidebar'}">
          💬 ${S.chatDrawerOpen ? 'Hide History' : `Chats (${S.convs.length})`}
        </button>
        <button class="btn btn-primary btn-sm" id="btn-start-tour-header">✨ Start Tour</button>
        <button class="btn btn-secondary btn-sm" id="btn-load-demo-header">Load Demo</button>
      `;
      root.innerHTML = renderChatView();
      setupChatListeners();
      scrollChatToBottom();
      break;

    case 'opps':
      titleEl.textContent = 'Opportunities & Applications';
      subEl.textContent = 'Track and manage your application lifecycle (Pending ➔ Applied ➔ Rejected)';
      actionsEl.innerHTML = `
        <button class="btn btn-primary btn-sm" id="btn-add-opp-modal">+ Add Opportunity</button>
      `;
      root.innerHTML = renderOpportunitiesView();
      setupOpportunitiesListeners();
      break;

    case 'outreach':
      titleEl.textContent = 'Cold Emailing & Outreach Tracker';
      subEl.textContent = 'Track student outreach, manage follow-up cadences, and generate high-converting drafts with Gemma 4';
      actionsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm" id="btn-ai-draft-header">✨ AI Draft Assistant</button>
        <button class="btn btn-primary btn-sm" id="btn-add-outreach-header">+ New Outreach</button>
      `;
      root.innerHTML = renderOutreachView();
      setupOutreachListeners();
      break;

    case 'reports':
      titleEl.textContent = 'Performance Reports & Funnel';
      subEl.textContent = 'Weekly and monthly assessment of your application velocity and follow-through';
      actionsEl.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="tab-group">
            <button class="tab-btn ${S.reportPeriod === 'month' ? 'active' : ''}" id="rep-period-month">This Month</button>
            <button class="tab-btn ${S.reportPeriod === 'week' ? 'active' : ''}" id="rep-period-week">This Week</button>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-export-excel" title="Download Excel Spreadsheet (.xlsx)">
            📥 Export to Excel
          </button>
        </div>
      `;
      root.innerHTML = renderReportsView();
      setupReportsListeners();
      break;

    case 'tasks':
      titleEl.textContent = 'Action Tasks';
      subEl.textContent = 'Checklist of resume updates, assignment submissions, and prep milestones';
      actionsEl.innerHTML = '';
      root.innerHTML = renderTasksView();
      setupTasksListeners();
      break;

    case 'events':
      titleEl.textContent = 'Interviews & Events';
      subEl.textContent = 'Upcoming technical rounds, webinars, and information sessions';
      actionsEl.innerHTML = `
        <button class="btn btn-primary btn-sm" id="btn-add-event-modal">+ Add Event</button>
      `;
      root.innerHTML = renderEventsView();
      setupEventsListeners();
      break;

    case 'cal':
      titleEl.textContent = 'Calendar Schedule';
      subEl.textContent = 'Visual monthly deadline map and schedule density';
      actionsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm" id="cal-today-btn">Today</button>
      `;
      root.innerHTML = renderCalendarView();
      setupCalendarListeners();
      break;

    case 'soon':
      titleEl.textContent = 'Due Soon (Next 7 Days)';
      subEl.textContent = 'Critical immediate deadlines requiring your urgent attention';
      actionsEl.innerHTML = '';
      root.innerHTML = renderDueSoonView();
      setupDueSoonListeners();
      break;

    case 'set':
      titleEl.textContent = 'Settings & Preferences';
      subEl.textContent = 'Profile, notification lead times, audio chime, and data management';
      actionsEl.innerHTML = '';
      root.innerHTML = renderSettingsView();
      setupSettingsListeners();
      break;
  }
}

function getNextActionableItem() {
  const allItems = [];

  (S.opps || []).forEach(o => {
    if (o.status !== 'rejected' && o.deadline) {
      const diff = daysUntil(o.deadline);
      if (diff !== null && diff >= 0) {
        allItems.push({
          type: 'Opportunity',
          title: o.title + (o.org ? ` (${o.org})` : ''),
          date: o.deadline,
          countdown: countdownText(o.deadline),
          diff,
          actionView: 'opps'
        });
      }
    }
  });

  (S.tasks || []).forEach(t => {
    if (!t.done && t.deadline) {
      const diff = daysUntil(t.deadline);
      if (diff !== null && diff >= 0) {
        allItems.push({
          type: 'Task',
          title: t.title,
          date: t.deadline,
          countdown: countdownText(t.deadline),
          diff,
          actionView: 'tasks'
        });
      }
    }
  });

  (S.outreach || []).forEach(r => {
    if ((r.status === 'sent' || r.status === 'followup_due') && r.next_followup_date) {
      const diff = daysUntil(r.next_followup_date);
      if (diff !== null && diff >= 0) {
        allItems.push({
          type: 'Follow-up',
          title: `Follow up with ${r.contact_name}${r.organization ? ` · ${r.organization}` : ''}`,
          date: r.next_followup_date,
          countdown: countdownText(r.next_followup_date),
          diff,
          actionView: 'outreach'
        });
      }
    }
  });

  allItems.sort((a, b) => a.diff - b.diff);
  return allItems.length > 0 ? allItems[0] : null;
}

/* ==========================================================================
   VIEW 1: Chat Assistant View
   ========================================================================== */
function renderChatView() {
  const filteredConvs = S.chatSearch
    ? S.convs.filter(c => (c.title || '').toLowerCase().includes(S.chatSearch.toLowerCase()) || (c.last_snippet || '').toLowerCase().includes(S.chatSearch.toLowerCase()))
    : S.convs;

  const convListHtml = filteredConvs.map(c => {
    const isActive = c.id === S.convId;
    const msgCount = c.message_count !== undefined ? c.message_count : '';
    return `
      <div class="chat-session-item ${isActive ? 'active' : ''}" data-conv-id="${c.id}">
        <div class="chat-session-top">
          <span class="chat-session-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</span>
          <div class="chat-session-actions">
            <button class="chat-item-btn edit" data-conv-action="rename" data-conv-id="${c.id}" title="Rename conversation">✏️</button>
            <button class="chat-item-btn delete" data-conv-action="delete" data-conv-id="${c.id}" title="Delete conversation">🗑️</button>
          </div>
        </div>
        ${c.last_snippet ? `<div class="chat-session-snippet">${escapeHtml(c.last_snippet.substring(0, 48))}</div>` : ''}
      </div>
    `;
  }).join('');

  const msgsHtml = S.msgs.map(m => {
    let actionsObj = null;
    if (m.actions) {
      try {
        actionsObj = typeof m.actions === 'string' ? JSON.parse(m.actions) : m.actions;
      } catch (e) {}
    }

    let actionsHtml = '';
    const isConfirmed = actionsObj && actionsObj.confirmed === true;
    if (actionsObj && actionsObj.type === 'deadline_card') {
      actionsHtml = renderDeadlineCard(actionsObj.item, m.id, isConfirmed);
    } else if (actionsObj && actionsObj.type === 'duplicate_verify') {
      actionsHtml = renderDuplicateCard(actionsObj, m.id, isConfirmed);
    }

    const formattedText = renderMarkdown(m.text);

    return `
      <div class="msg-row ${m.role}">
        <div class="msg-avatar">${m.role === 'user' ? '👤' : '⚡'}</div>
        <div class="msg-content-wrapper">
          <div class="msg-bubble">
            ${m.image_name ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">📎 Attached flyer / screenshot</div>` : ''}
            ${formattedText}
          </div>
          ${actionsHtml}
        </div>
      </div>
    `;
  }).join('');

  const nextItem = getNextActionableItem();
  const nextItemHtml = nextItem ? `
    <div class="next-priority-pill" data-view="${nextItem.actionView}" title="View in ${nextItem.type}">
      <span class="next-priority-label">Next Priority</span>
      <span class="next-priority-title">${escapeHtml(nextItem.title)}</span>
      <span class="next-priority-date">${escapeHtml(nextItem.countdown)} · ${formatDate(nextItem.date)}</span>
      <span class="next-priority-arrow">→</span>
    </div>
  ` : '';

  return `
    <div id="chat-layout">
      <!-- Collapsible Chat Sessions Drawer -->
      <aside class="chat-drawer ${S.chatDrawerOpen ? '' : 'collapsed'}" id="chat-drawer">
        <div class="chat-drawer-header">
          <span class="chat-drawer-title">💬 Conversations (${S.convs.length})</span>
          <div style="display:flex; align-items:center; gap:6px;">
            <button class="btn btn-primary btn-sm" id="btn-new-chat" style="padding: 4px 8px; font-size: 0.74rem;">+ New</button>
            <button class="btn-ghost-sm" id="btn-close-chat-drawer" title="Collapse conversations sidebar (reserve space)">◀</button>
          </div>
        </div>
        <div class="chat-drawer-search">
          <input type="text" id="chat-search-input" placeholder="Search chats by title or text..." value="${escapeHtml(S.chatSearch || '')}">
        </div>
        <div class="chat-drawer-list" id="chat-drawer-list">
          ${convListHtml || `<div class="chat-drawer-empty">No conversations found</div>`}
        </div>
      </aside>

      <!-- Main Chat Area -->
      <div class="chat-main-area">
        ${!S.chatDrawerOpen ? `
          <div class="chat-drawer-reopen-bar">
            <button class="btn btn-secondary btn-sm" id="btn-reopen-chat-drawer" title="Expand conversations sidebar" style="padding: 3px 10px; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 6px;">
              <span>💬 Show Conversations (${S.convs.length})</span>
              <span style="font-size:0.68rem; color:var(--text-muted);">▶</span>
            </button>
          </div>
        ` : ''}
        <div class="chat-history" id="chat-history-box">
          <!-- Welcoming Hero Banner -->
          <div class="hero-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:8px; flex-wrap:wrap;">
              <div>
                <h3>Let's make today feel more manageable.</h3>
                <p style="margin-bottom:0;">Drop an opportunity link, paste a poster screenshot, or describe an upcoming deadline. Nudge organizes your timeline, schedules reminders, and keeps your academic goals on track.</p>
              </div>
              <button class="btn btn-secondary btn-sm" id="btn-hero-tour" style="white-space:nowrap;">
                ✨ Start Tour
              </button>
            </div>

            ${nextItemHtml}

            <div class="prompt-chips" style="margin-top:12px;">
              <button class="chip-btn" data-prompt="What opportunities or deadlines are coming up?">🔍 Find opportunities</button>
              <button class="chip-btn" data-prompt="Add task: Prepare project submission report for Friday">📝 Add a task</button>
              <button class="chip-btn" data-prompt="Remind me in 3 days to check application status">⏰ Set a reminder</button>
              <button class="chip-btn" data-prompt="Add opportunity: Summer Software Internship deadline 28 Oct">💼 Track an application</button>
            </div>
          </div>

          ${msgsHtml}

          ${S.isSending ? `
            <div class="msg-row bot">
              <div class="msg-avatar">⚡</div>
              <div class="msg-content-wrapper">
                <div class="msg-bubble" style="display:flex; align-items:center; gap:8px;">
                  <span class="spinner-dot" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--primary); animation:pulse 1s infinite alternate;"></span>
                  <span>Extracting deadline & details from input...</span>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Composer Bar -->
        <div class="chat-composer-wrapper">
          <div class="chat-composer">
            <!-- Image upload preview thumbnail -->
            <div class="image-preview-bar" id="image-preview-bar">
              <img src="" class="image-preview-thumb" id="image-preview-img" alt="Preview">
              <div class="image-preview-info">
                <span class="image-preview-name" id="image-preview-name">poster.png</span>
                <button class="image-preview-remove" id="image-preview-remove">✕ Remove</button>
              </div>
            </div>

            <div class="composer-input-row">
              <textarea class="composer-textarea" id="chat-textarea" rows="1" placeholder="Type a message, paste a link, or drop a flyer..."></textarea>
              <div class="composer-tools">
                <label class="icon-btn" title="Upload poster/screenshot (PNG, JPG, WebP)">
                  📷
                  <input type="file" id="chat-file-input" accept="image/png,image/jpeg,image/webp" style="display:none;">
                </label>
                <button class="send-btn" id="chat-send-btn" title="Send message (Enter)">➤</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDeadlineCard(item, msgId, isConfirmed = false) {
  const suggested = item.suggested_deadline || item.deadline || addDays(3);
  const countdown = countdownText(suggested);

  if (isConfirmed) {
    return `
      <div class="action-card deadline-card confirmed-card" data-msg-id="${msgId}">
        <div class="card-header-badge" style="color:var(--success);">✓ Confirmed & Scheduled</div>
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="card-subtitle">${item.org ? `Organization: <strong>${escapeHtml(item.org)}</strong> • ` : ''}Category: <span class="badge badge-${item.category}">${item.category}</span></div>
        <div class="card-confirmed-banner">
          <span>✓ Deadline confirmed for <strong>${formatDate(suggested)}</strong> (${countdown}). Proactive reminders active.</span>
        </div>
      </div>
    `;
  }

  // Month and Year for mini calendar
  const today = todayIST();
  const [sY, sM] = suggested.split('-').map(Number);
  const miniCalHtml = buildMiniCalendar(sY, sM - 1, suggested);

  const hasExplicitDate = item.has_explicit_date !== undefined ? item.has_explicit_date : true;
  let opt1Header = 'Option 1: Extracted Deadline';
  let opt1BtnText = `✓ Accept Extracted Deadline (${formatDate(suggested)})`;

  if (item.evidence === 'image') {
    opt1Header = '📸 Option 1: Extracted Directly from Poster / Photo';
    opt1BtnText = `✓ Accept Poster Deadline (${formatDate(suggested)})`;
  } else if (item.evidence === 'page') {
    opt1Header = '🔗 Option 1: Extracted Directly from Website Listing';
    opt1BtnText = `✓ Accept Website Deadline (${formatDate(suggested)})`;
  } else if (item.evidence === 'text' && hasExplicitDate) {
    opt1Header = '✍️ Option 1: Extracted from Message';
    opt1BtnText = `✓ Accept Extracted Deadline (${formatDate(suggested)})`;
  } else if (!hasExplicitDate || item.evidence === 'none') {
    opt1Header = 'ℹ️ Option 1: Pre-filled Default (+3 Days — No date found in source)';
    opt1BtnText = `✓ Accept Suggested 3-Day Deadline (${formatDate(suggested)})`;
  }

  return `
    <div class="action-card deadline-card" data-msg-id="${msgId}">
      <div class="card-header-badge">⚡ Interactive Confirmation</div>
      <div class="card-title">${escapeHtml(item.title)}</div>
      <div class="card-subtitle">${item.org ? `Organization: <strong>${escapeHtml(item.org)}</strong> • ` : ''}Category: <span class="badge badge-${item.category}">${item.category}</span></div>

      <!-- Horizontal 2-Option Confirmation Grid -->
      <div class="deadline-options-row">
        <!-- Option 1: Auto-suggested 1-click -->
        <div class="option-block option-suggested">
          <div class="option-header" style="${item.evidence === 'image' || item.evidence === 'page' ? 'color:var(--success);' : ''}">${opt1Header}</div>
          <div class="option-date-display">
            <span class="date-large">${formatDate(suggested)}</span>
            <span class="countdown-pill ${daysUntil(suggested) <= 3 ? 'urgent' : ''}">${countdown}</span>
          </div>
          <div class="option-hint-text">
            ${item.evidence === 'image' ? '📸 Directly recognized from uploaded flyer/screenshot' : (item.evidence === 'page' ? '🔗 Directly extracted from website page' : (hasExplicitDate ? '✍️ Explicitly extracted from message' : '⚡ 3-day reminder default'))}
          </div>
          <div class="option-action-footer">
            <button class="btn btn-primary btn-md" style="width:100%;"
              data-act="accept_suggested"
              data-title="${escapeHtml(item.title)}"
              data-org="${escapeHtml(item.org || '')}"
              data-cat="${item.category || 'other'}"
              data-deadline="${suggested}"
              data-loc="${escapeHtml(item.location || '')}"
              data-url="${escapeHtml(item.url || '')}">
              ${opt1BtnText}
            </button>
          </div>
        </div>

        <!-- Option 2: Custom Manual Override -->
        <div class="option-block option-manual">
          <div class="option-header">🗓️ Option 2: Custom Manual Deadline</div>

          <!-- Quick preset chips -->
          <div class="preset-chips-row">
            <button class="preset-chip" data-preset="${addDays(1)}">Tomorrow</button>
            <button class="preset-chip" data-preset="${addDays(3)}">+3 Days</button>
            <button class="preset-chip" data-preset="${addDays(7)}">+7 Days</button>
            <button class="preset-chip" data-preset="${addDays(14)}">+14 Days</button>
          </div>

          <!-- Inline Mini-Calendar Widget -->
          <div class="mini-cal-container" id="mini-cal-${msgId}">
            ${miniCalHtml}
          </div>

          <!-- Manual date field with browser icon hidden via CSS -->
          <div class="custom-date-row">
            <input type="date" class="input-control no-browser-icon" id="manual-date-${msgId}" value="${suggested}">
            <button class="btn btn-secondary btn-sm" style="white-space:nowrap;"
              data-act="set_manual"
              data-msg-target="${msgId}"
              data-title="${escapeHtml(item.title)}"
              data-org="${escapeHtml(item.org || '')}"
              data-cat="${item.category || 'other'}"
              data-loc="${escapeHtml(item.location || '')}"
              data-url="${escapeHtml(item.url || '')}">
              Confirm Date
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDuplicateCard(dupObj, msgId, isConfirmed = false) {
  const ex = dupObj.existing;
  const inc = dupObj.incoming;

  if (isConfirmed) {
    return `
      <div class="action-card duplicate-card confirmed-card" data-msg-id="${msgId}">
        <div class="card-header-badge" style="color:var(--success);">✓ Duplicate Resolution Saved</div>
        <div class="card-title">${escapeHtml(inc.title || ex.title)}</div>
        <div class="card-confirmed-banner">
          <span>✓ Entry resolution saved to tracker.</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="action-card duplicate-card" data-msg-id="${msgId}">
      <div class="card-header-badge" style="color:var(--warning);">⚠️ Duplicate Opportunity Detected</div>
      <div class="card-title">${escapeHtml(inc.title || ex.title)}</div>
      <div class="card-subtitle">An opportunity from this organization or title already exists in your tracker.</div>

      <div class="dup-comparison-box">
        <div class="dup-field-row">
          <span class="dup-label">Existing Deadline:</span>
          <span class="dup-val-existing">${formatDate(ex.deadline) || 'None'} (${ex.status})</span>
        </div>
        <div class="dup-field-row">
          <span class="dup-label">Incoming Deadline:</span>
          <span class="dup-val-incoming">${formatDate(inc.deadline) || 'Unset'}</span>
        </div>
      </div>

      <div class="dup-actions-row">
        <button class="btn btn-primary btn-sm"
          data-act="dup_update"
          data-ex-id="${ex.id}"
          data-deadline="${inc.deadline || ex.deadline}">
          Update Existing
        </button>
        <button class="btn btn-secondary btn-sm"
          data-act="dup_add_anyway"
          data-title="${escapeHtml(inc.title)}"
          data-org="${escapeHtml(inc.org || '')}"
          data-cat="${inc.category || 'other'}"
          data-deadline="${inc.deadline}">
          Add as New Entry
        </button>
        <button class="btn btn-danger btn-sm"
          data-act="dup_cancel">
          Keep Existing
        </button>
      </div>
    </div>
  `;
}

function buildMiniCalendar(year, month, selectedDateStr) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayIST();

  let daysHtml = '';
  // Empty padding cells
  for (let i = 0; i < firstDay; i++) {
    daysHtml += `<div class="mini-cal-day disabled"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const curDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = curDateStr === today;
    const isSelected = curDateStr === selectedDateStr;
    const isPast = curDateStr < today;

    daysHtml += `
      <button type="button" class="mini-cal-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isPast ? 'disabled' : ''}"
        data-cal-date="${curDateStr}">
        ${d}
      </button>
    `;
  }

  return `
    <div class="mini-cal-header">
      <button type="button" class="mini-cal-nav-btn" data-mini-nav="-1" data-year="${year}" data-month="${month}">◀</button>
      <span class="mini-cal-title">${months[month]} ${year}</span>
      <button type="button" class="mini-cal-nav-btn" data-mini-nav="1" data-year="${year}" data-month="${month}">▶</button>
    </div>
    <div class="mini-cal-days-header">
      <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
    </div>
    <div class="mini-cal-grid">
      ${daysHtml}
    </div>
  `;
}

function setupChatListeners() {
  const textarea = document.getElementById('chat-textarea');
  const sendBtn = document.getElementById('chat-send-btn');
  const fileInput = document.getElementById('chat-file-input');
  const removeImgBtn = document.getElementById('image-preview-remove');

  // Toggle chat drawer from header
  const toggleDrawerBtn = document.getElementById('btn-toggle-chat-drawer');
  if (toggleDrawerBtn) {
    toggleDrawerBtn.addEventListener('click', () => {
      S.chatDrawerOpen = !S.chatDrawerOpen;
      localStorage.setItem('nudge_chat_drawer_open', S.chatDrawerOpen ? 'true' : 'false');
      renderActiveView();
    });
  }

  // Close chat drawer from inside drawer header
  const closeDrawerBtn = document.getElementById('btn-close-chat-drawer');
  if (closeDrawerBtn) {
    closeDrawerBtn.addEventListener('click', () => {
      S.chatDrawerOpen = false;
      localStorage.setItem('nudge_chat_drawer_open', 'false');
      renderActiveView();
    });
  }

  // Re-open chat drawer from inside main chat area
  const reopenDrawerBtn = document.getElementById('btn-reopen-chat-drawer');
  if (reopenDrawerBtn) {
    reopenDrawerBtn.addEventListener('click', () => {
      S.chatDrawerOpen = true;
      localStorage.setItem('nudge_chat_drawer_open', 'true');
      renderActiveView();
    });
  }

  // New Chat button
  const newChatBtn = document.getElementById('btn-new-chat');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Copilot Chat' })
        });
        if (res.ok) {
          const newConv = await res.json();
          S.convId = newConv.id;
          playChime();
          showToast('Created new conversation', '💬');
          await fetchState();
        }
      } catch (err) {
        showToast('Could not create conversation', '⚠️');
      }
    });
  }

  // Chat search input
  const searchInput = document.getElementById('chat-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      S.chatSearch = e.target.value;
      const listEl = document.getElementById('chat-drawer-list');
      if (listEl) {
        const filteredConvs = S.chatSearch
          ? S.convs.filter(c => (c.title || '').toLowerCase().includes(S.chatSearch.toLowerCase()) || (c.last_snippet || '').toLowerCase().includes(S.chatSearch.toLowerCase()))
          : S.convs;
        listEl.innerHTML = filteredConvs.map(c => `
          <div class="chat-session-item ${c.id === S.convId ? 'active' : ''}" data-conv-id="${c.id}">
            <div class="chat-session-top">
              <span class="chat-session-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</span>
              <div class="chat-session-actions">
                <button class="chat-item-btn edit" data-conv-action="rename" data-conv-id="${c.id}" title="Rename conversation">✏️</button>
                <button class="chat-item-btn delete" data-conv-action="delete" data-conv-id="${c.id}" title="Delete conversation">🗑️</button>
              </div>
            </div>
            ${c.last_snippet ? `<div class="chat-session-snippet">${escapeHtml(c.last_snippet.substring(0, 48))}</div>` : ''}
          </div>
        `).join('') || `<div class="chat-drawer-empty">No conversations found</div>`;
      }
    });
  }

  // Conversation session list click delegation
  const drawerList = document.getElementById('chat-drawer-list');
  if (drawerList) {
    drawerList.addEventListener('click', async (e) => {
      const renameBtn = e.target.closest('[data-conv-action="rename"]');
      if (renameBtn) {
        e.stopPropagation();
        const cid = parseInt(renameBtn.dataset.convId, 10);
        const currentConv = S.convs.find(c => c.id === cid);
        const newTitle = prompt('Enter new conversation title:', currentConv?.title || '');
        if (newTitle && newTitle.trim()) {
          try {
            const res = await fetch(`/api/conversations/${cid}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: newTitle.trim() })
            });
            if (res.ok) {
              showToast('Conversation renamed', '✓');
              await fetchState();
            }
          } catch (err) {
            showToast('Failed to rename conversation', '⚠️');
          }
        }
        return;
      }

      const deleteBtn = e.target.closest('[data-conv-action="delete"]');
      if (deleteBtn) {
        e.stopPropagation();
        const cid = parseInt(deleteBtn.dataset.convId, 10);
        if (confirm('Delete this conversation? Chat history will be permanently removed (your saved opportunities and tasks will NOT be deleted).')) {
          try {
            const res = await fetch(`/api/conversations/${cid}`, { method: 'DELETE' });
            if (res.ok) {
              showToast('Conversation deleted', '✓');
              if (S.convId === cid) {
                S.convId = null;
              }
              await fetchState();
            }
          } catch (err) {
            showToast('Failed to delete conversation', '⚠️');
          }
        }
        return;
      }

      const sessionItem = e.target.closest('.chat-session-item');
      if (sessionItem) {
        const cid = parseInt(sessionItem.dataset.convId, 10);
        if (cid && cid !== S.convId) {
          S.convId = cid;
          await fetchMessages(cid);
          renderActiveView();
        }
      }
    });
  }

  // Tour buttons
  const tourHeaderBtn = document.getElementById('btn-start-tour-header');
  const tourHeroBtn = document.getElementById('btn-hero-tour');
  const tourSidebarBtn = document.getElementById('sidebar-tour-btn');

  if (tourHeaderBtn) tourHeaderBtn.addEventListener('click', () => startInteractiveTour());
  if (tourHeroBtn) tourHeroBtn.addEventListener('click', () => startInteractiveTour());
  if (tourSidebarBtn) tourSidebarBtn.addEventListener('click', () => startInteractiveTour());

  // Load demo from header button
  const loadDemoBtn = document.getElementById('btn-load-demo-header');
  if (loadDemoBtn) {
    loadDemoBtn.addEventListener('click', async () => {
      await seedDemo();
    });
  }

  // Quick prompt chips
  document.querySelectorAll('.chip-btn').forEach(chip => {
    chip.addEventListener('click', () => {
      if (textarea) {
        textarea.value = chip.dataset.prompt;
        sendChatMessage();
      }
    });
  });

  // Next priority navigation pill
  document.querySelectorAll('.next-priority-pill[data-view]').forEach(pill => {
    pill.addEventListener('click', () => {
      setView(pill.dataset.view);
    });
  });


  // Textarea auto-resize & Enter key
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', sendChatMessage);
  }

  // File Upload
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 4 * 1024 * 1024) {
        showToast('Image exceeds 4MB limit', '⚠️');
        fileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (evt) => {
        S.currentUploadImage = evt.target.result;
        const bar = document.getElementById('image-preview-bar');
        const img = document.getElementById('image-preview-img');
        const name = document.getElementById('image-preview-name');
        if (bar && img && name) {
          img.src = S.currentUploadImage;
          name.textContent = file.name;
          bar.style.display = 'flex';
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeImgBtn) {
    removeImgBtn.addEventListener('click', () => {
      S.currentUploadImage = null;
      const bar = document.getElementById('image-preview-bar');
      if (bar) bar.style.display = 'none';
      if (fileInput) fileInput.value = '';
    });
  }

  // Clipboard Paste for Both Text and Images
  const composer = document.querySelector('.chat-composer');

  const handleClipboardPaste = (e) => {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    // 1. Check for image item in clipboard
    const items = clipboardData.items;
    let imageItem = null;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.startsWith('image/')) {
          imageItem = items[i];
          break;
        }
      }
    }

    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;

      if (file.size > 4 * 1024 * 1024) {
        showToast('Pasted image exceeds 4MB limit', '⚠️');
        return;
      }

      const reader = new FileReader();
      reader.onload = (evt) => {
        S.currentUploadImage = evt.target.result;
        const bar = document.getElementById('image-preview-bar');
        const img = document.getElementById('image-preview-img');
        const name = document.getElementById('image-preview-name');
        if (bar && img && name) {
          img.src = S.currentUploadImage;
          name.textContent = file.name || 'clipboard_screenshot.png';
          bar.style.display = 'flex';
          playChime();
          showToast('Screenshot / image pasted from clipboard! 📋', '📸');
        }
      };
      reader.readAsDataURL(file);
      return;
    }

    // 2. Text paste onto composer outside textarea
    if (e.target !== textarea && clipboardData.getData) {
      const pastedText = clipboardData.getData('text');
      if (pastedText && textarea) {
        e.preventDefault();
        textarea.value += pastedText;
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
        showToast('Text pasted into composer', '📝');
      }
    }
  };

  if (textarea) textarea.addEventListener('paste', handleClipboardPaste);
  if (composer) composer.addEventListener('paste', handleClipboardPaste);

  // Drag-and-drop onto typing box
  if (composer) {
    ['dragenter', 'dragover'].forEach(name => {
      composer.addEventListener(name, (e) => {
        e.preventDefault();
        composer.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      composer.addEventListener(name, (e) => {
        e.preventDefault();
        composer.classList.remove('drag-over');
      });
    });
    composer.addEventListener('drop', (e) => {
      e.preventDefault();
      composer.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type && file.type.startsWith('image/')) {
          if (file.size > 4 * 1024 * 1024) {
            showToast('Dropped image exceeds 4MB limit', '⚠️');
            return;
          }
          const reader = new FileReader();
          reader.onload = (evt) => {
            S.currentUploadImage = evt.target.result;
            const bar = document.getElementById('image-preview-bar');
            const img = document.getElementById('image-preview-img');
            const name = document.getElementById('image-preview-name');
            if (bar && img && name) {
              img.src = S.currentUploadImage;
              name.textContent = file.name || 'dropped_flyer.png';
              bar.style.display = 'flex';
              playChime();
              showToast('Flyer dropped into typing box! 📥', '🖼️');
            }
          };
          reader.readAsDataURL(file);
        }
      }
    });
  }

  // Interactive Card Actions (delegated on chat container)
  const chatContainer = document.getElementById('chat-history-box');
  if (chatContainer) {
    chatContainer.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-act]');
      if (!target) {
        // Check mini calendar day click
        const dayBtn = e.target.closest('[data-cal-date]');
        if (dayBtn) {
          const date = dayBtn.dataset.calDate;
          const card = dayBtn.closest('.action-card');
          if (card) {
            const input = card.querySelector('input[type="date"]');
            if (input) input.value = date;
            card.querySelectorAll('.mini-cal-day').forEach(b => b.classList.remove('selected'));
            dayBtn.classList.add('selected');
          }
        }

        // Check mini calendar month navigation
        const navBtn = e.target.closest('[data-mini-nav]');
        if (navBtn) {
          const delta = parseInt(navBtn.dataset.miniNav, 10);
          let y = parseInt(navBtn.dataset.year, 10);
          let m = parseInt(navBtn.dataset.month, 10) + delta;
          if (m < 0) { m = 11; y--; }
          if (m > 11) { m = 0; y++; }
          const calContainer = navBtn.closest('.mini-cal-container');
          const card = navBtn.closest('.action-card');
          const input = card?.querySelector('input[type="date"]');
          const curVal = input ? input.value : todayIST();
          if (calContainer) {
            calContainer.innerHTML = buildMiniCalendar(y, m, curVal);
          }
        }

        // Check preset chips
        const presetBtn = e.target.closest('[data-preset]');
        if (presetBtn) {
          const date = presetBtn.dataset.preset;
          const card = presetBtn.closest('.action-card');
          if (card) {
            const input = card.querySelector('input[type="date"]');
            if (input) input.value = date;
            card.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('selected'));
            presetBtn.classList.add('selected');
            const cal = card.querySelector('.mini-cal-container');
            if (cal) {
              const [y, m] = date.split('-').map(Number);
              cal.innerHTML = buildMiniCalendar(y, m - 1, date);
            }
          }
        }
        return;
      }

      const act = target.dataset.act;
      const card = target.closest('.action-card');
      const msgId = card ? parseInt(card.dataset.msgId, 10) : null;

      if (act === 'accept_suggested') {
        const payload = {
          title: target.dataset.title,
          org: target.dataset.org,
          category: target.dataset.cat,
          deadline: target.dataset.deadline,
          location: target.dataset.loc,
          url: target.dataset.url
        };
        await executeCardAction('accept_suggested', payload, msgId);
      }

      else if (act === 'set_manual') {
        const targetId = target.dataset.msgTarget;
        const dateInput = document.getElementById(`manual-date-${targetId}`);
        const customDate = dateInput ? dateInput.value : todayIST();

        const payload = {
          title: target.dataset.title,
          org: target.dataset.org,
          category: target.dataset.cat,
          deadline: customDate,
          location: target.dataset.loc,
          url: target.dataset.url
        };
        await executeCardAction('set_manual', payload, msgId);
      }

      else if (act === 'dup_update') {
        const payload = {
          existingId: parseInt(target.dataset.exId, 10),
          deadline: target.dataset.deadline
        };
        await executeCardAction('dup_update', payload, msgId);
      }

      else if (act === 'dup_add_anyway') {
        const payload = {
          title: target.dataset.title,
          org: target.dataset.org,
          category: target.dataset.cat,
          deadline: target.dataset.deadline
        };
        await executeCardAction('dup_add_anyway', payload, msgId);
      }

      else if (act === 'dup_cancel') {
        await executeCardAction('dup_cancel', {}, msgId);
      }
    });
  }
}

async function sendChatMessage() {
  const textarea = document.getElementById('chat-textarea');
  if (!textarea) return;

  const text = textarea.value.trim();
  const image = S.currentUploadImage;

  if (!text && !image) return;
  if (S.isSending) return;

  S.isSending = true;
  textarea.value = '';
  textarea.style.height = 'auto';

  // Optimistically append user message to UI
  S.msgs.push({
    id: Date.now(),
    role: 'user',
    text,
    actions: null,
    image_name: image ? 'uploaded_poster.png' : null
  });

  // Clear upload bar
  S.currentUploadImage = null;
  const bar = document.getElementById('image-preview-bar');
  if (bar) bar.style.display = 'none';
  const fileInput = document.getElementById('chat-file-input');
  if (fileInput) fileInput.value = '';

  renderActiveView();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: S.convId,
        text,
        image
      })
    });

    if (!res.ok) throw new Error('Chat API returned error');
    const data = await res.json();

    if (data.state) {
      S.opps = data.state.opps || S.opps;
      S.tasks = data.state.tasks || S.tasks;
      S.events = data.state.events || S.events;
      S.convs = data.state.convs || S.convs;
      S.outreach = data.state.outreach || S.outreach;
      S.outreachMetrics = data.state.outreachMetrics || S.outreachMetrics;
    }

    if (S.convId) {
      await fetchMessages(S.convId);
    }

    playChime();
    updateBadges();
  } catch (err) {
    console.error('sendChatMessage error:', err);
    showToast('Failed to process message', '⚠️');
  } finally {
    S.isSending = false;
    renderActiveView();
  }
}

async function executeCardAction(action, payload, msgId = null) {
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        payload,
        conversation_id: S.convId,
        message_id: msgId
      })
    });

    if (!res.ok) throw new Error('Action failed');
    const data = await res.json();

    playChime();
    if (action === 'accept_suggested' || action === 'set_manual') {
      showToast('Opportunity saved.', '✓');
    } else if (action === 'create_task') {
      showToast('Task added to your list.', '✓');
    } else if (action === 'create_event') {
      showToast('Reminder scheduled.', '✓');
    } else {
      showToast('Opportunity saved.', '✓');
    }

    if (data.state) {
      S.opps = data.state.opps || S.opps;
      S.tasks = data.state.tasks || S.tasks;
      S.events = data.state.events || S.events;
      S.convs = data.state.convs || S.convs;
      S.outreach = data.state.outreach || S.outreach;
      S.outreachMetrics = data.state.outreachMetrics || S.outreachMetrics;
    }

    if (S.convId) {
      await fetchMessages(S.convId);
    }

    updateBadges();
    renderActiveView();
  } catch (err) {
    console.error('executeCardAction error:', err);
    showToast('Action failed', '⚠️');
  }
}

function scrollChatToBottom() {
  const box = document.getElementById('chat-history-box');
  if (box) {
    setTimeout(() => {
      box.scrollTop = box.scrollHeight;
    }, 50);
  }
}

/* ==========================================================================
   VIEW 2: Opportunities View (with 3-State Lifecycle Dialog)
   ========================================================================== */
function renderOpportunitiesView() {
  const filtered = S.opps.filter(o => {
    if (S.filterStatus === 'all') return true;
    return o.status === S.filterStatus;
  });

  const cardsHtml = filtered.length === 0 ? `
    <div class="outreach-empty-state" style="grid-column: 1/-1;">
      <div class="empty-icon" style="font-size: 2.2rem; margin-bottom: 4px;">🎯</div>
      <h3 style="font-size: 1.05rem; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Your application tracker is ready</h3>
      <p style="color: var(--text-secondary); max-width: 440px; font-size: 0.86rem; line-height: 1.5;">
        Keep track of internships, scholarships, and fellowships. Drop a link or poster into Copilot, or record an application directly.
      </p>
      <button class="btn btn-primary btn-sm" id="btn-empty-add-opp" style="margin-top: 8px;">+ Add an opportunity</button>
    </div>
  ` : filtered.map(o => {
    const countdown = countdownText(o.deadline);
    const diff = daysUntil(o.deadline);
    const isUrgent = diff !== null && diff <= 3 && diff >= 0;

    return `
      <div class="opp-card" data-opp-id="${o.id}">
        <div class="opp-card-top">
          <div class="opp-badges">
            <span class="badge badge-${o.category || 'other'}">${o.category || 'other'}</span>
            ${o.location ? `<span class="badge badge-other">📍 ${escapeHtml(o.location)}</span>` : ''}
          </div>
          <button class="status-badge status-${o.status}" data-action="open-status-modal" data-opp-id="${o.id}" title="Click to change status">
            ${o.status === 'applied' ? '✓' : o.status === 'rejected' ? '✕' : '⏳'} ${o.status}
          </button>
        </div>

        <div class="opp-title">${escapeHtml(o.title)}</div>
        <div class="opp-org">🏢 ${escapeHtml(o.org || 'Organization not specified')}</div>

        <div class="opp-meta">
          <div class="opp-deadline-row">
            <span>Deadline: <span class="opp-deadline-date">${formatDate(o.deadline)}</span></span>
            <span class="countdown-pill ${isUrgent ? 'urgent' : ''}">${countdown}</span>
          </div>
          ${o.url ? `
            <div style="margin-top: 6px;">
              <a href="${o.url}" target="_blank" rel="noopener" style="color:var(--primary); text-decoration:none; font-size:0.78rem; display:inline-flex; align-items:center; gap:4px;">
                🔗 View Portal Listing
              </a>
            </div>
          ` : ''}
          <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:8px;">
            <button class="btn btn-secondary btn-sm" data-action="delete-opp" data-opp-id="${o.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="filter-bar">
      <div class="tab-group">
        <button class="tab-btn ${S.filterStatus === 'all' ? 'active' : ''}" data-filter="all">All (${S.opps.length})</button>
        <button class="tab-btn ${S.filterStatus === 'pending' ? 'active' : ''}" data-filter="pending">Pending (${S.opps.filter(o => o.status === 'pending').length})</button>
        <button class="tab-btn ${S.filterStatus === 'applied' ? 'active' : ''}" data-filter="applied">Applied (${S.opps.filter(o => o.status === 'applied').length})</button>
        <button class="tab-btn ${S.filterStatus === 'rejected' ? 'active' : ''}" data-filter="rejected">Rejected (${S.opps.filter(o => o.status === 'rejected').length})</button>
      </div>
      <div>
        <button class="btn btn-danger btn-sm" id="btn-clear-all-opps">Clear All</button>
      </div>
    </div>
    <div class="opp-grid">
      ${cardsHtml}
    </div>
  `;
}

function setupOpportunitiesListeners() {
  // Tab filter
  document.querySelectorAll('[data-filter]').forEach(tab => {
    tab.addEventListener('click', () => {
      S.filterStatus = tab.dataset.filter;
      renderActiveView();
    });
  });

  // Add opp button
  const addBtn = document.getElementById('btn-add-opp-modal');
  if (addBtn) {
    addBtn.addEventListener('click', openAddOpportunityModal);
  }

  const emptyAddBtn = document.getElementById('btn-empty-add-opp');
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener('click', openAddOpportunityModal);
  }

  // Clear all button
  const clearBtn = document.getElementById('btn-clear-all-opps');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete all tracked opportunities?')) {
        await fetch('/api/opportunities', { method: 'DELETE' });
        await fetchState();
        showToast('All opportunities cleared', '✓');
      }
    });
  }

  // Delegated clicks for status modal and delete
  document.querySelectorAll('[data-action="open-status-modal"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const oppId = parseInt(btn.dataset.oppId, 10);
      openStatusChangeModal(oppId);
    });
  });

  document.querySelectorAll('[data-action="delete-opp"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const oppId = parseInt(btn.dataset.oppId, 10);
      if (confirm('Delete this opportunity?')) {
        await fetch(`/api/opportunities/${oppId}`, { method: 'DELETE' });
        await fetchState();
        showToast('Opportunity removed', '✓');
      }
    });
  });
}

function openStatusChangeModal(oppId) {
  const opp = S.opps.find(o => o.id === oppId);
  if (!opp) return;

  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  modalRoot.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">Update Lifecycle Status</div>
      <div class="modal-body">
        Select the current workflow state for <strong>${escapeHtml(opp.title)}</strong>:
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">
        <button class="btn btn-secondary ${opp.status === 'pending' ? 'btn-primary' : ''}" data-set-status="pending" style="justify-content:flex-start; padding:12px;">
          ⏳ <strong>Pending</strong> — In progress or preparing application
        </button>
        <button class="btn btn-secondary ${opp.status === 'applied' ? 'btn-primary' : ''}" data-set-status="applied" style="justify-content:flex-start; padding:12px;">
          ✓ <strong>Applied</strong> — Application submitted to portal
        </button>
        <button class="btn btn-secondary ${opp.status === 'rejected' ? 'btn-danger' : ''}" data-set-status="rejected" style="justify-content:flex-start; padding:12px;">
          ✕ <strong>Rejected</strong> — Application concluded or closed
        </button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('modal-cancel-btn').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });

  modalRoot.querySelectorAll('[data-set-status]').forEach(b => {
    b.addEventListener('click', async () => {
      const newStatus = b.dataset.setStatus;
      modalRoot.style.display = 'none';
      await fetch(`/api/opportunities/${oppId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      playChime();
      showToast(`Status updated to ${newStatus}`, '✓');
      await fetchState();
    });
  });
}

function openAddOpportunityModal() {
  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  modalRoot.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">Add New Opportunity</div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Role or Title *</label>
          <input type="text" id="modal-opp-title" class="input-control" placeholder="e.g. Google SWE Intern 2027" required>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Company / Organization</label>
          <input type="text" id="modal-opp-org" class="input-control" placeholder="e.g. Google">
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          <div class="form-group">
            <label class="form-label">Category</label>
            <select id="modal-opp-cat" class="input-control">
              <option value="internship">Internship</option>
              <option value="hackathon">Hackathon</option>
              <option value="scholarship">Scholarship</option>
              <option value="assignment">Assignment</option>
              <option value="event">Event</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Deadline Date</label>
            <input type="date" id="modal-opp-date" class="input-control" value="${addDays(3)}">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Location (Optional)</label>
          <input type="text" id="modal-opp-loc" class="input-control" placeholder="e.g. Remote, Bengaluru, New York">
        </div>
        <div class="form-group">
          <label class="form-label">Application URL (Optional)</label>
          <input type="url" id="modal-opp-url" class="input-control" placeholder="https://careers...">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-add-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-add-save">Save Opportunity</button>
      </div>
    </div>
  `;

  document.getElementById('modal-add-cancel').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });

  document.getElementById('modal-add-save').addEventListener('click', async () => {
    const title = document.getElementById('modal-opp-title').value.trim();
    if (!title) {
      showToast('Title is required', '⚠️');
      return;
    }
    const org = document.getElementById('modal-opp-org').value.trim();
    const category = document.getElementById('modal-opp-cat').value;
    const deadline = document.getElementById('modal-opp-date').value;
    const location = document.getElementById('modal-opp-loc').value.trim();
    const url = document.getElementById('modal-opp-url').value.trim();

    modalRoot.style.display = 'none';
    await fetch('/api/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, org, category, deadline, location, url, status: 'pending' })
    });
    playChime();
    showToast('Opportunity created!', '✓');
    await fetchState();
  });
}

/* ==========================================================================
   VIEW: Cold Emailing & Outreach Tracker
   ========================================================================== */
function renderOutreachView() {
  const m = S.outreachMetrics || {
    total: S.outreach.length,
    drafts: 0,
    sent: 0,
    replied: 0,
    replyRate: 0,
    meetings: 0,
    followupDue: 0
  };

  const today = todayIST();

  // Filter records
  const filtered = S.outreach.filter(o => {
    // Status tab filter
    if (S.outreachFilter === 'draft' && (o.status !== 'draft' && o.status !== 'ready_to_send')) return false;
    if (S.outreachFilter === 'sent' && o.status !== 'sent') return false;
    if (S.outreachFilter === 'due') {
      const isDue = (o.status === 'sent' || o.status === 'followup_due') && o.next_followup_date && o.next_followup_date <= today;
      if (!isDue) return false;
    }
    if (S.outreachFilter === 'replied' && (o.status !== 'replied' && o.status !== 'meeting_scheduled')) return false;
    if (S.outreachFilter === 'meeting' && o.status !== 'meeting_scheduled') return false;
    if (S.outreachFilter === 'closed' && o.status !== 'closed') return false;

    // Search filter
    if (S.outreachSearch) {
      const q = S.outreachSearch.toLowerCase();
      const match = (o.contact_name || '').toLowerCase().includes(q) ||
        (o.organization || '').toLowerCase().includes(q) ||
        (o.role || '').toLowerCase().includes(q) ||
        (o.subject || '').toLowerCase().includes(q) ||
        (o.notes || '').toLowerCase().includes(q);
      if (!match) return false;
    }

    return true;
  });

  const cardsHtml = filtered.length === 0 ? `
    <div class="outreach-empty-state">
      <div class="empty-icon" style="font-size:2.4rem; margin-bottom:4px;">📨</div>
      <h3 style="font-size:1.05rem; font-weight:600; color:var(--text-main); margin-bottom:4px;">Your outreach starts here.</h3>
      <p style="color:var(--text-secondary); max-width:440px; font-size:0.86rem; line-height:1.5;">
        Keep track of the people you contact and know when to follow up. Generate authentic email drafts with Gemma 4 or log existing outreach.
      </p>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn btn-primary btn-sm" id="btn-empty-add-outreach">+ Add an outreach record</button>
        <button class="btn btn-secondary btn-sm" id="btn-empty-ai-draft">✨ Draft with Gemma 4</button>
      </div>
    </div>
  ` : filtered.map(o => {
    const isDue = (o.status === 'sent' || o.status === 'followup_due') && o.next_followup_date && o.next_followup_date <= today;
    const diff = o.next_followup_date ? daysUntil(o.next_followup_date) : null;
    const countdown = o.next_followup_date ? countdownText(o.next_followup_date) : '';

    return `
      <div class="outreach-card" data-outreach-id="${o.id}">
        <div class="outreach-card-top">
          <div class="outreach-contact-info">
            <span class="outreach-contact-name">${escapeHtml(o.contact_name)}</span>
            <span class="outreach-contact-role">${escapeHtml(o.role || 'Professional')}${o.organization ? ` at <strong class="outreach-contact-org">${escapeHtml(o.organization)}</strong>` : ''}</span>
            ${o.contact_email ? `
              <a href="mailto:${escapeHtml(o.contact_email)}" style="color:var(--text-muted); font-size:0.75rem; text-decoration:none; margin-top:2px;" title="Email contact">
                ✉️ ${escapeHtml(o.contact_email)}
              </a>
            ` : ''}
          </div>
          <div class="outreach-badges-row">
            <span class="badge badge-${o.category || 'internship'}">${o.category || 'internship'}</span>
            <span class="badge-status badge-status-${isDue ? 'due' : o.status}">
              ${isDue ? '⏰ Follow-up Due' : o.status.replace('_', ' ')}
            </span>
          </div>
        </div>

        ${o.subject ? `
          <div class="outreach-subject-preview" title="Subject preview">
            <strong>Subj:</strong> ${escapeHtml(o.subject)}
          </div>
        ` : ''}

        <div class="outreach-meta-row">
          <span>First Contact: <strong>${formatDate(o.first_contact_date)}</strong></span>
          ${o.next_followup_date ? `
            <span class="outreach-followup-pill ${isDue ? 'urgent' : ''}">
              ⏰ Next: ${formatDate(o.next_followup_date)} (${countdown})
            </span>
          ` : ''}
          ${o.response_date ? `<span>Replied: <strong>${formatDate(o.response_date)}</strong></span>` : ''}
        </div>

        ${o.notes ? `
          <div class="outreach-notes-snippet">
            ${escapeHtml(o.notes)}
          </div>
        ` : ''}

        <div class="outreach-card-actions">
          <button class="btn btn-secondary btn-sm" data-outreach-act="copy" data-id="${o.id}" title="Copy email subject and body to clipboard">
            📋 Copy
          </button>
          ${o.status === 'draft' || o.status === 'ready_to_send' ? `
            <button class="btn btn-primary btn-sm" data-outreach-act="mark-sent" data-id="${o.id}">
              ✉️ Mark Sent
            </button>
          ` : `
            <button class="btn btn-secondary btn-sm" data-outreach-act="schedule-followup" data-id="${o.id}">
              ⏰ Follow-up
            </button>
            <button class="btn btn-secondary btn-sm" data-outreach-act="record-reply" data-id="${o.id}">
              💬 Reply
            </button>
          `}
          <button class="btn btn-secondary btn-sm" data-outreach-act="edit" data-id="${o.id}" title="Edit contact details">
            ✏️
          </button>
          <button class="btn btn-secondary btn-sm" data-outreach-act="delete" data-id="${o.id}" style="color:var(--danger);" title="Delete outreach">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="outreach-container">
      <!-- 6 Metrics Cards Row -->
      <div class="outreach-metrics-grid">
        <div class="outreach-metric-card">
          <span class="outreach-metric-label">Total Contacts</span>
          <span class="outreach-metric-value">${m.total}</span>
        </div>
        <div class="outreach-metric-card">
          <span class="outreach-metric-label">Drafts</span>
          <span class="outreach-metric-value">${m.drafts}</span>
        </div>
        <div class="outreach-metric-card">
          <span class="outreach-metric-label">Sent</span>
          <span class="outreach-metric-value">${m.sent}</span>
        </div>
        <div class="outreach-metric-card ${m.followupDue > 0 ? 'due-alert' : ''}">
          <span class="outreach-metric-label">Follow-ups Due</span>
          <span class="outreach-metric-value" style="${m.followupDue > 0 ? 'color:var(--warning);' : ''}">${m.followupDue}</span>
        </div>
        <div class="outreach-metric-card highlight">
          <span class="outreach-metric-label">Replied (${m.replyRate}%)</span>
          <span class="outreach-metric-value" style="color:var(--success);">${m.replied}</span>
        </div>
        <div class="outreach-metric-card highlight">
          <span class="outreach-metric-label">Meetings</span>
          <span class="outreach-metric-value" style="color:var(--primary);">${m.meetings}</span>
        </div>
      </div>

      <!-- Controls: Tabs + Search -->
      <div class="outreach-controls-bar">
        <div class="outreach-tabs">
          <button class="outreach-tab-btn ${S.outreachFilter === 'all' ? 'active' : ''}" data-outreach-filter="all">All (${S.outreach.length})</button>
          <button class="outreach-tab-btn ${S.outreachFilter === 'draft' ? 'active' : ''}" data-outreach-filter="draft">Drafts (${m.drafts})</button>
          <button class="outreach-tab-btn ${S.outreachFilter === 'sent' ? 'active' : ''}" data-outreach-filter="sent">Sent (${m.sent})</button>
          <button class="outreach-tab-btn ${S.outreachFilter === 'due' ? 'active' : ''}" data-outreach-filter="due">Follow-ups Due (${m.followupDue})</button>
          <button class="outreach-tab-btn ${S.outreachFilter === 'replied' ? 'active' : ''}" data-outreach-filter="replied">Replied (${m.replied})</button>
          <button class="outreach-tab-btn ${S.outreachFilter === 'meeting' ? 'active' : ''}" data-outreach-filter="meeting">Meetings (${m.meetings})</button>
          <button class="outreach-tab-btn ${S.outreachFilter === 'closed' ? 'active' : ''}" data-outreach-filter="closed">Closed</button>
        </div>

        <div class="outreach-search-box">
          <input type="text" class="outreach-search-input" id="outreach-search-input" placeholder="Search contacts, orgs, subjects..." value="${escapeHtml(S.outreachSearch || '')}">
        </div>
      </div>

      <!-- Outreach Cards Grid -->
      <div class="outreach-cards-grid">
        ${cardsHtml}
      </div>
    </div>
  `;
}

function setupOutreachListeners() {
  // Tabs
  document.querySelectorAll('[data-outreach-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.outreachFilter = btn.dataset.outreachFilter;
      renderActiveView();
    });
  });

  // Search input
  const searchInput = document.getElementById('outreach-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      S.outreachSearch = e.target.value;
      renderActiveView();
      // Keep focus on search input after re-render
      const newSearchInput = document.getElementById('outreach-search-input');
      if (newSearchInput) {
        newSearchInput.focus();
        newSearchInput.setSelectionRange(newSearchInput.value.length, newSearchInput.value.length);
      }
    });
  }

  // Header buttons
  document.getElementById('btn-add-outreach-header')?.addEventListener('click', () => openAddOutreachModal());
  document.getElementById('btn-ai-draft-header')?.addEventListener('click', () => openAIDraftModal());

  // Empty state buttons
  document.getElementById('btn-empty-add-outreach')?.addEventListener('click', () => openAddOutreachModal());
  document.getElementById('btn-empty-ai-draft')?.addEventListener('click', () => openAIDraftModal());

  // Card action delegation
  const grid = document.querySelector('.outreach-cards-grid');
  if (grid) {
    grid.addEventListener('click', async (e) => {
      const actBtn = e.target.closest('[data-outreach-act]');
      if (!actBtn) return;

      const act = actBtn.dataset.outreachAct;
      const id = parseInt(actBtn.dataset.id, 10);
      const record = S.outreach.find(r => r.id === id);
      if (!record && act !== 'draft') return;

      if (act === 'copy') {
        const textToCopy = `Subject: ${record.subject || ''}\n\n${record.body || ''}`.trim();
        if (textToCopy) {
          navigator.clipboard.writeText(textToCopy);
          playChime();
          showToast('Subject & body copied to clipboard! 📋', '✓');
        } else {
          showToast('No email content to copy', '⚠️');
        }
      }

      else if (act === 'mark-sent') {
        openMarkSentModal(id);
      }

      else if (act === 'schedule-followup') {
        openScheduleFollowupModal(id);
      }

      else if (act === 'record-reply') {
        openRecordReplyModal(id);
      }

      else if (act === 'edit') {
        openEditOutreachModal(id);
      }

      else if (act === 'delete') {
        if (confirm(`Delete outreach record for ${record.contact_name}?`)) {
          try {
            const res = await fetch(`/api/outreach/${id}`, { method: 'DELETE' });
            if (res.ok) {
              playChime();
              showToast('Outreach record deleted', '✓');
              await fetchState();
            }
          } catch (err) {
            showToast('Failed to delete outreach record', '⚠️');
          }
        }
      }
    });
  }
}

function openAddOutreachModal(initial = null) {
  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  const contactName = initial?.contact_name || '';
  const contactEmail = initial?.contact_email || '';
  const organization = initial?.organization || '';
  const role = initial?.role || '';
  const category = initial?.category || 'internship';
  const subject = initial?.subject || '';
  const body = initial?.body || '';
  const notes = initial?.notes || '';
  const status = initial?.status || 'draft';
  const followupDate = initial?.next_followup_date || '';

  modalRoot.innerHTML = `
    <div class="modal-box" style="max-width: 580px;">
      <div class="modal-title">➕ Add Outreach Contact</div>
      <div class="modal-body" style="max-height: 72vh; overflow-y: auto;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div class="form-group">
            <label class="form-label">Contact Name *</label>
            <input type="text" id="modal-out-name" class="input-control" value="${escapeHtml(contactName)}" placeholder="e.g. Dr. Priya Sharma" required autofocus>
          </div>
          <div class="form-group">
            <label class="form-label">Contact Email</label>
            <input type="email" id="modal-out-email" class="input-control" value="${escapeHtml(contactEmail)}" placeholder="e.g. priya@google.com">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div class="form-group">
            <label class="form-label">Company / Organization</label>
            <input type="text" id="modal-out-org" class="input-control" value="${escapeHtml(organization)}" placeholder="e.g. Google DeepMind">
          </div>
          <div class="form-group">
            <label class="form-label">Contact Role</label>
            <input type="text" id="modal-out-role" class="input-control" value="${escapeHtml(role)}" placeholder="e.g. Research Scientist">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div class="form-group">
            <label class="form-label">Category</label>
            <select id="modal-out-cat" class="input-control">
              <option value="internship" ${category === 'internship' ? 'selected' : ''}>Internship</option>
              <option value="research" ${category === 'research' ? 'selected' : ''}>Research / Lab</option>
              <option value="referral" ${category === 'referral' ? 'selected' : ''}>Referral Inquiry</option>
              <option value="fulltime" ${category === 'fulltime' ? 'selected' : ''}>Full-time Role</option>
              <option value="other" ${category === 'other' ? 'selected' : ''}>Networking / Other</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Initial Status</label>
            <select id="modal-out-status" class="input-control">
              <option value="draft" ${status === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="ready_to_send" ${status === 'ready_to_send' ? 'selected' : ''}>Ready to Send</option>
              <option value="sent" ${status === 'sent' ? 'selected' : ''}>Already Sent</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label class="form-label">Subject Line</label>
          <input type="text" id="modal-out-subject" class="input-control" value="${escapeHtml(subject)}" placeholder="e.g. Undergraduate Research Inquiry: Multimodal Agents">
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label class="form-label">Email Body</label>
          <textarea id="modal-out-body" class="input-control" style="min-height: 120px; font-family: inherit; line-height: 1.45;" placeholder="Draft email body...">${escapeHtml(body)}</textarea>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div class="form-group">
            <label class="form-label">Next Follow-up Date (Optional)</label>
            <input type="date" id="modal-out-followup" class="input-control" value="${escapeHtml(followupDate)}">
          </div>
          <div class="form-group">
            <label class="form-label">Notes / Follow-up Strategy</label>
            <input type="text" id="modal-out-notes" class="input-control" value="${escapeHtml(notes)}" placeholder="e.g. Paper referenced: Gemma fine-tuning">
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-out-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-out-save">Save Outreach</button>
      </div>
    </div>
  `;

  document.getElementById('modal-out-cancel').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });

  document.getElementById('modal-out-save').addEventListener('click', async () => {
    const contact_name = document.getElementById('modal-out-name').value.trim();
    if (!contact_name) {
      showToast('Contact name is required', '⚠️');
      return;
    }
    const contact_email = document.getElementById('modal-out-email').value.trim();
    const organization = document.getElementById('modal-out-org').value.trim();
    const role = document.getElementById('modal-out-role').value.trim();
    const category = document.getElementById('modal-out-cat').value;
    const status = document.getElementById('modal-out-status').value;
    const subject = document.getElementById('modal-out-subject').value.trim();
    const body = document.getElementById('modal-out-body').value.trim();
    const next_followup_date = document.getElementById('modal-out-followup').value || null;
    const notes = document.getElementById('modal-out-notes').value.trim();
    const first_contact_date = status === 'sent' ? todayIST() : null;

    modalRoot.style.display = 'none';

    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_name,
          contact_email,
          organization,
          role,
          category,
          status,
          subject,
          body,
          first_contact_date,
          next_followup_date,
          notes
        })
      });

      if (res.ok) {
        playChime();
        showToast(`Outreach contact for ${contact_name} saved!`, '✓');
        await fetchState();
      } else {
        showToast('Failed to save outreach', '⚠️');
      }
    } catch (err) {
      showToast('Server error saving outreach', '⚠️');
    }
  });
}

function openEditOutreachModal(id) {
  const o = S.outreach.find(r => r.id === id);
  if (!o) return;

  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  modalRoot.innerHTML = `
    <div class="modal-box" style="max-width: 580px;">
      <div class="modal-title">✏️ Edit Outreach Record</div>
      <div class="modal-body" style="max-height: 72vh; overflow-y: auto;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div class="form-group">
            <label class="form-label">Contact Name *</label>
            <input type="text" id="modal-edit-name" class="input-control" value="${escapeHtml(o.contact_name)}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Contact Email</label>
            <input type="email" id="modal-edit-email" class="input-control" value="${escapeHtml(o.contact_email || '')}">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div class="form-group">
            <label class="form-label">Company / Organization</label>
            <input type="text" id="modal-edit-org" class="input-control" value="${escapeHtml(o.organization || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Contact Role</label>
            <input type="text" id="modal-edit-role" class="input-control" value="${escapeHtml(o.role || '')}">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div class="form-group">
            <label class="form-label">Category</label>
            <select id="modal-edit-cat" class="input-control">
              <option value="internship" ${o.category === 'internship' ? 'selected' : ''}>Internship</option>
              <option value="research" ${o.category === 'research' ? 'selected' : ''}>Research / Lab</option>
              <option value="referral" ${o.category === 'referral' ? 'selected' : ''}>Referral Inquiry</option>
              <option value="fulltime" ${o.category === 'fulltime' ? 'selected' : ''}>Full-time Role</option>
              <option value="other" ${o.category === 'other' ? 'selected' : ''}>Networking / Other</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select id="modal-edit-status" class="input-control">
              <option value="draft" ${o.status === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="ready_to_send" ${o.status === 'ready_to_send' ? 'selected' : ''}>Ready to Send</option>
              <option value="sent" ${o.status === 'sent' ? 'selected' : ''}>Sent</option>
              <option value="replied" ${o.status === 'replied' ? 'selected' : ''}>Replied</option>
              <option value="meeting_scheduled" ${o.status === 'meeting_scheduled' ? 'selected' : ''}>Meeting Scheduled</option>
              <option value="closed" ${o.status === 'closed' ? 'selected' : ''}>Closed</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label class="form-label">Subject Line</label>
          <input type="text" id="modal-edit-subject" class="input-control" value="${escapeHtml(o.subject || '')}">
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label class="form-label">Email Body</label>
          <textarea id="modal-edit-body" class="input-control" style="min-height: 120px; font-family: inherit; line-height: 1.45;">${escapeHtml(o.body || '')}</textarea>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div class="form-group">
            <label class="form-label">Next Follow-up Date</label>
            <input type="date" id="modal-edit-followup" class="input-control" value="${escapeHtml(o.next_followup_date || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <input type="text" id="modal-edit-notes" class="input-control" value="${escapeHtml(o.notes || '')}">
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-edit-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-edit-save">Update Outreach</button>
      </div>
    </div>
  `;

  document.getElementById('modal-edit-cancel').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });

  document.getElementById('modal-edit-save').addEventListener('click', async () => {
    const contact_name = document.getElementById('modal-edit-name').value.trim();
    if (!contact_name) {
      showToast('Contact name is required', '⚠️');
      return;
    }
    const contact_email = document.getElementById('modal-edit-email').value.trim();
    const organization = document.getElementById('modal-edit-org').value.trim();
    const role = document.getElementById('modal-edit-role').value.trim();
    const category = document.getElementById('modal-edit-cat').value;
    const status = document.getElementById('modal-edit-status').value;
    const subject = document.getElementById('modal-edit-subject').value.trim();
    const body = document.getElementById('modal-edit-body').value.trim();
    const next_followup_date = document.getElementById('modal-edit-followup').value || null;
    const notes = document.getElementById('modal-edit-notes').value.trim();

    modalRoot.style.display = 'none';

    try {
      const res = await fetch(`/api/outreach/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_name,
          contact_email,
          organization,
          role,
          category,
          status,
          subject,
          body,
          next_followup_date,
          notes
        })
      });

      if (res.ok) {
        playChime();
        showToast('Outreach record updated!', '✓');
        await fetchState();
      } else {
        showToast('Failed to update outreach', '⚠️');
      }
    } catch (err) {
      showToast('Server error updating outreach', '⚠️');
    }
  });
}

function openMarkSentModal(id) {
  const o = S.outreach.find(r => r.id === id);
  if (!o) return;

  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  const defaultFollowup = addDays(4);

  modalRoot.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">✉️ Mark as Sent</div>
      <div class="modal-body">
        <p style="color:var(--text-secondary); margin-bottom:14px; font-size:0.88rem;">
          Confirm sending outreach to <strong>${escapeHtml(o.contact_name)}</strong> (${escapeHtml(o.organization || 'Contact')}). Nudge will schedule automated follow-up reminders.
        </p>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Sent Date</label>
          <input type="date" id="modal-sent-date" class="input-control" value="${todayIST()}">
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Schedule Next Follow-up (Recommended: +4 Days)</label>
          <div class="preset-chips-row" style="margin-bottom:8px;">
            <button class="preset-chip selected" data-sent-preset="${addDays(4)}">+4 Days (Recommended)</button>
            <button class="preset-chip" data-sent-preset="${addDays(7)}">+7 Days</button>
            <button class="preset-chip" data-sent-preset="${addDays(14)}">+14 Days</button>
            <button class="preset-chip" data-sent-preset="">No Follow-up</button>
          </div>
          <input type="date" id="modal-sent-followup" class="input-control" value="${defaultFollowup}">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-sent-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-sent-confirm">Confirm Sent 🚀</button>
      </div>
    </div>
  `;

  modalRoot.querySelectorAll('[data-sent-preset]').forEach(chip => {
    chip.addEventListener('click', () => {
      modalRoot.querySelectorAll('[data-sent-preset]').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      const val = chip.dataset.sentPreset;
      document.getElementById('modal-sent-followup').value = val;
    });
  });

  document.getElementById('modal-sent-cancel').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });

  document.getElementById('modal-sent-confirm').addEventListener('click', async () => {
    const sent_date = document.getElementById('modal-sent-date').value || todayIST();
    const next_followup_date = document.getElementById('modal-sent-followup').value || null;

    modalRoot.style.display = 'none';

    try {
      const res = await fetch(`/api/outreach/${id}/sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sent_date, next_followup_date })
      });

      if (res.ok) {
        playChime();
        showToast(`Marked as sent! Follow-up set for ${next_followup_date ? formatDate(next_followup_date) : 'None'}.`, '✓');
        await fetchState();
      }
    } catch (err) {
      showToast('Error marking outreach as sent', '⚠️');
    }
  });
}

function openScheduleFollowupModal(id) {
  const o = S.outreach.find(r => r.id === id);
  if (!o) return;

  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  const defaultDate = o.next_followup_date || addDays(3);

  modalRoot.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">⏰ Schedule Follow-up</div>
      <div class="modal-body">
        <p style="color:var(--text-secondary); margin-bottom:14px; font-size:0.88rem;">
          Schedule or reschedule follow-up for <strong>${escapeHtml(o.contact_name)}</strong>.
        </p>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Next Follow-up Date</label>
          <div class="preset-chips-row" style="margin-bottom:8px;">
            <button class="preset-chip" data-followup-preset="${addDays(3)}">+3 Days</button>
            <button class="preset-chip" data-followup-preset="${addDays(5)}">+5 Days</button>
            <button class="preset-chip" data-followup-preset="${addDays(7)}">+7 Days</button>
          </div>
          <input type="date" id="modal-sched-date" class="input-control" value="${defaultDate}">
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Follow-up Notes / Context</label>
          <input type="text" id="modal-sched-notes" class="input-control" value="${escapeHtml(o.notes || '')}" placeholder="e.g. Sent 1st follow-up referencing paper">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-sched-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-sched-save">Update Follow-up</button>
      </div>
    </div>
  `;

  modalRoot.querySelectorAll('[data-followup-preset]').forEach(chip => {
    chip.addEventListener('click', () => {
      modalRoot.querySelectorAll('[data-followup-preset]').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      document.getElementById('modal-sched-date').value = chip.dataset.followupPreset;
    });
  });

  document.getElementById('modal-sched-cancel').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });

  document.getElementById('modal-sched-save').addEventListener('click', async () => {
    const next_followup_date = document.getElementById('modal-sched-date').value;
    const notes = document.getElementById('modal-sched-notes').value.trim();

    if (!next_followup_date) {
      showToast('Please select a date', '⚠️');
      return;
    }

    modalRoot.style.display = 'none';

    try {
      const res = await fetch(`/api/outreach/${id}/followup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_followup_date, notes })
      });

      if (res.ok) {
        playChime();
        showToast(`Follow-up scheduled for ${formatDate(next_followup_date)}!`, '✓');
        await fetchState();
      }
    } catch (err) {
      showToast('Error scheduling follow-up', '⚠️');
    }
  });
}

function openRecordReplyModal(id) {
  const o = S.outreach.find(r => r.id === id);
  if (!o) return;

  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  modalRoot.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">💬 Record Contact Reply</div>
      <div class="modal-body">
        <p style="color:var(--text-secondary); margin-bottom:14px; font-size:0.88rem;">
          Great news! Recording a reply automatically cancels obsolete follow-up reminders.
        </p>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Outcome / Response Type</label>
          <select id="modal-reply-outcome" class="input-control">
            <option value="replied">💬 Replied (Interested / Discussion in Progress)</option>
            <option value="meeting_scheduled">🗓️ Meeting / Interview Scheduled</option>
            <option value="closed">✕ Closed (Not hiring / Passed)</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Response Date</label>
          <input type="date" id="modal-reply-date" class="input-control" value="${todayIST()}">
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Notes (Meeting time, key takeaways, etc.)</label>
          <textarea id="modal-reply-notes" class="input-control" style="min-height:70px;" placeholder="e.g. Coffee chat scheduled for next Tuesday at 2pm.">${escapeHtml(o.notes || '')}</textarea>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-reply-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-reply-confirm">Save Reply 🎉</button>
      </div>
    </div>
  `;

  document.getElementById('modal-reply-cancel').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });

  document.getElementById('modal-reply-confirm').addEventListener('click', async () => {
    const outcome = document.getElementById('modal-reply-outcome').value;
    const response_date = document.getElementById('modal-reply-date').value || todayIST();
    const notes = document.getElementById('modal-reply-notes').value.trim();

    modalRoot.style.display = 'none';

    try {
      const res = await fetch(`/api/outreach/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, response_date, notes })
      });

      if (res.ok) {
        playChime();
        showToast('Reply recorded! Reminders updated.', '✓');
        await fetchState();
      }
    } catch (err) {
      showToast('Error recording reply', '⚠️');
    }
  });
}

function openAIDraftModal() {
  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  modalRoot.innerHTML = `
    <div class="modal-box" style="max-width: 620px;">
      <div class="modal-title" style="display:flex; align-items:center; gap:8px;">
        <span>✨</span>
        <span>Gemma 4 Cold Email Copilot</span>
      </div>
      <div class="modal-body" style="max-height: 74vh; overflow-y: auto;">
        <p style="color:var(--text-secondary); font-size:0.84rem; margin-bottom:14px; line-height:1.4;">
          Generate authentic, high-converting outreach emails with Gemma 4. 
          <em style="color:var(--text-main);">Strict accuracy guardrails prevent hallucinated qualifications.</em>
        </p>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
          <div class="form-group">
            <label class="form-label">Outreach Purpose</label>
            <select id="draft-purpose" class="input-control">
              <option value="internship">Summer / Fall Internship</option>
              <option value="research">Undergraduate Research / Lab Intern</option>
              <option value="referral">Employee Referral Inquiry</option>
              <option value="networking">Informational Coffee Chat</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Tone</label>
            <select id="draft-tone" class="input-control">
              <option value="professional">Professional & Courteous</option>
              <option value="concise">Ultra-Concise (< 100 words)</option>
              <option value="enthusiastic">Enthusiastic & Driven</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
          <div class="form-group">
            <label class="form-label">Recipient Name</label>
            <input type="text" id="draft-rec-name" class="input-control" placeholder="e.g. Dr. Priya Sharma / Alex Chen">
          </div>
          <div class="form-group">
            <label class="form-label">Target Organization</label>
            <input type="text" id="draft-rec-org" class="input-control" placeholder="e.g. Google DeepMind / Microsoft">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
          <div class="form-group">
            <label class="form-label">Recipient Role</label>
            <input type="text" id="draft-rec-role" class="input-control" placeholder="e.g. Principal Scientist / SWE Manager">
          </div>
          <div class="form-group">
            <label class="form-label">Specific Opportunity / Context</label>
            <input type="text" id="draft-rec-opp" class="input-control" placeholder="e.g. Summer 2027 SWE Internship">
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label class="form-label">Your Background / Focus (Optional)</label>
          <input type="text" id="draft-user-bg" class="input-control" value="${escapeHtml(S.profile.major ? S.profile.major + ' student' + (S.profile.college ? ' at ' + S.profile.college : '') : '')}" placeholder="e.g. CS Sophomore specializing in AI systems">
        </div>

        <div class="form-group" style="margin-bottom: 14px; display:flex; align-items:center; gap:8px;">
          <input type="checkbox" id="draft-is-followup" style="accent-color:var(--primary); width:16px; height:16px;">
          <label for="draft-is-followup" style="font-size:0.84rem; cursor:pointer; color:var(--text-main);">
            This is a polite follow-up to an earlier email
          </label>
        </div>

        <button class="btn btn-primary" id="btn-generate-draft" style="width:100%; justify-content:center; padding:10px; box-shadow: 0 4px 14px var(--primary-glow);">
          ⚡ Generate Draft with Gemma 4
        </button>

        <!-- Live Preview Output Area -->
        <div id="draft-output-area" style="display:none; margin-top:16px;">
          <div class="draft-notes-alert" id="draft-notes-alert">
            ℹ️ <span>Replace [bracketed placeholders] with your actual project details before sending!</span>
          </div>

          <div class="draft-preview-box">
            <span class="draft-field-label">Subject Line</span>
            <input type="text" id="draft-out-subject" class="input-control draft-subject-input">

            <span class="draft-field-label">Email Body</span>
            <textarea id="draft-out-body" class="input-control draft-body-textarea"></textarea>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:12px;">
            <button class="btn btn-secondary btn-sm" id="btn-draft-copy">📋 Copy Draft</button>
            <button class="btn btn-primary btn-sm" id="btn-draft-create-outreach">➕ Create Outreach Record</button>
          </div>
        </div>
      </div>

      <div class="modal-actions" style="border-top:1px solid var(--border-subtle); padding-top:12px;">
        <button class="btn btn-secondary" id="modal-draft-close">Close</button>
      </div>
    </div>
  `;

  document.getElementById('modal-draft-close').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });

  const genBtn = document.getElementById('btn-generate-draft');
  const outputArea = document.getElementById('draft-output-area');
  const subjInput = document.getElementById('draft-out-subject');
  const bodyTextarea = document.getElementById('draft-out-body');

  let currentDraftData = null;

  genBtn.addEventListener('click', async () => {
    const purpose = document.getElementById('draft-purpose').value;
    const tone = document.getElementById('draft-tone').value;
    const recipient_name = document.getElementById('draft-rec-name').value.trim();
    const recipient_org = document.getElementById('draft-rec-org').value.trim();
    const recipient_role = document.getElementById('draft-rec-role').value.trim();
    const opportunity_details = document.getElementById('draft-rec-opp').value.trim();
    const user_background = document.getElementById('draft-user-bg').value.trim();
    const is_followup = document.getElementById('draft-is-followup').checked;

    genBtn.disabled = true;
    genBtn.textContent = 'Generating with Gemma 4...';

    try {
      const res = await fetch('/api/outreach/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose,
          tone,
          recipient_name,
          recipient_org,
          recipient_role,
          opportunity_details,
          user_background,
          is_followup
        })
      });

      if (!res.ok) throw new Error('Draft API error');
      const data = await res.json();

      currentDraftData = {
        contact_name: recipient_name || 'Hiring Lead',
        organization: recipient_org,
        role: recipient_role,
        category: purpose === 'research' ? 'research' : (purpose === 'referral' ? 'referral' : 'internship'),
        subject: data.subject || '',
        body: data.body || '',
        notes: data.notes || ''
      };

      subjInput.value = data.subject || '';
      bodyTextarea.value = data.body || '';
      outputArea.style.display = 'block';

      playChime();
      showToast('Gemma 4 generated your draft! ✨', '✓');
    } catch (err) {
      showToast('Could not generate draft', '⚠️');
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = '⚡ Re-generate with Gemma 4';
    }
  });

  document.getElementById('btn-draft-copy')?.addEventListener('click', () => {
    const textToCopy = `Subject: ${subjInput.value}\n\n${bodyTextarea.value}`.trim();
    navigator.clipboard.writeText(textToCopy);
    playChime();
    showToast('Draft copied to clipboard! 📋', '✓');
  });

  document.getElementById('btn-draft-create-outreach')?.addEventListener('click', () => {
    if (!currentDraftData) return;
    currentDraftData.subject = subjInput.value;
    currentDraftData.body = bodyTextarea.value;
    modalRoot.style.display = 'none';
    openAddOutreachModal(currentDraftData);
  });
}

/* ==========================================================================
   VIEW 3: Reports & Performance Assessment View
   ========================================================================== */
function renderReportsView() {
  const total = S.opps.length;
  const applied = S.opps.filter(o => o.status === 'applied').length;
  const pending = S.opps.filter(o => o.status === 'pending').length;
  const rejected = S.opps.filter(o => o.status === 'rejected').length;

  const appliedPct = total > 0 ? Math.round((applied / total) * 100) : 0;
  const pendingPct = total > 0 ? Math.round((pending / total) * 100) : 0;
  const rejectedPct = total > 0 ? Math.round((rejected / total) * 100) : 0;

  const activeTasks = S.tasks.filter(t => !t.done).length;
  const completedTasks = S.tasks.filter(t => t.done).length;
  const taskPct = S.tasks.length > 0 ? Math.round((completedTasks / S.tasks.length) * 100) : 0;

  // Motivational feedback based on applied rate
  let assessmentTitle = 'Good Momentum!';
  let assessmentMessage = 'You are actively monitoring applications. Make sure to complete submissions for pending opportunities before their deadlines.';
  if (appliedPct >= 50) {
    assessmentTitle = 'Outstanding Follow-Through! 🚀';
    assessmentMessage = `You have submitted ${applied} out of ${total} opportunities (${appliedPct}% conversion). Your application velocity is in the top bracket.`;
  } else if (total === 0) {
    assessmentTitle = 'Tracker is Empty';
    assessmentMessage = 'No opportunities tracked yet. Drop a flyer or job link in Chat Assistant to jumpstart your career pipeline.';
  } else if (pending > 3) {
    assessmentTitle = 'Submission Bottleneck Detected';
    assessmentMessage = `You have ${pending} pending applications due soon. Allocate focused time this week to submit your materials.`;
  }

  return `
    <div class="reports-container">
      <!-- Assessment Banner -->
      <div class="assessment-banner">
        <div class="assessment-text">
          <h3>${assessmentTitle}</h3>
          <p>${assessmentMessage}</p>
        </div>
        <div class="assessment-score-circle">
          <span class="score-num">${appliedPct}%</span>
          <span class="score-lbl">Applied</span>
        </div>
      </div>

      <!-- Multi-Segment Funnel Progress Bar -->
      <div class="progress-card">
        <div class="progress-header">
          <strong style="font-size:0.92rem;">Application Pipeline Breakdown</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">${total} Total Tracked</span>
        </div>
        <div class="progress-bar-multi">
          <div class="seg-applied" style="width: ${appliedPct}%;" title="Applied: ${applied}"></div>
          <div class="seg-pending" style="width: ${pendingPct}%;" title="Pending: ${pending}"></div>
          <div class="seg-rejected" style="width: ${rejectedPct}%;" title="Rejected: ${rejected}"></div>
        </div>
        <div class="progress-legend">
          <div class="legend-item"><span class="legend-dot" style="background:#10b981;"></span> Applied (${applied} • ${appliedPct}%)</div>
          <div class="legend-item"><span class="legend-dot" style="background:#a855f7;"></span> Pending (${pending} • ${pendingPct}%)</div>
          <div class="legend-item"><span class="legend-dot" style="background:#ef4444;"></span> Rejected (${rejected} • ${rejectedPct}%)</div>
        </div>
      </div>

      <!-- 4-Metric Grid -->
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-title">Total Opportunities</span>
          <span class="metric-value">${total}</span>
          <span class="metric-sub">Across all categories</span>
        </div>

        <div class="metric-card">
          <span class="metric-title">Applied Submissions</span>
          <span class="metric-value" style="color:#10b981;">${applied}</span>
          <span class="metric-sub">${appliedPct}% submission rate</span>
        </div>

        <div class="metric-card">
          <span class="metric-title">Task Completion</span>
          <span class="metric-value" style="color:var(--primary);">${taskPct}%</span>
          <span class="metric-sub">${completedTasks} of ${S.tasks.length} finished</span>
        </div>

        <div class="metric-card">
          <span class="metric-title">Pending Action</span>
          <span class="metric-value" style="color:#a855f7;">${pending}</span>
          <span class="metric-sub">Require submission</span>
        </div>
      </div>

      <!-- Export to Excel Card -->
      <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:18px 22px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:14px;">
          <span style="font-size:1.8rem; background:rgba(16, 185, 129, 0.15); color:#10b981; width:44px; height:44px; border-radius:var(--radius-md); display:flex; align-items:center; justify-content:center;">📊</span>
          <div>
            <strong style="color:var(--text-main); font-size:1rem;">Export Complete Tracker Dossier to Excel</strong>
            <p style="color:var(--text-muted); font-size:0.82rem; margin-top:2px;">Download all opportunities, lifecycle stages, task checklists, and metrics in multi-sheet .xlsx format.</p>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-export-excel-banner">
          📥 Download .xlsx Spreadsheet
        </button>
      </div>
    </div>
  `;
}

function setupReportsListeners() {
  const mBtn = document.getElementById('rep-period-month');
  const wBtn = document.getElementById('rep-period-week');

  if (mBtn) mBtn.addEventListener('click', () => { S.reportPeriod = 'month'; renderActiveView(); });
  if (wBtn) wBtn.addEventListener('click', () => { S.reportPeriod = 'week'; renderActiveView(); });

  const exportBtn1 = document.getElementById('btn-export-excel');
  const exportBtn2 = document.getElementById('btn-export-excel-banner');

  const triggerExport = () => {
    playChime();
    showToast('Exporting complete dossier to Excel (.xlsx)...', '📥');
    window.location.href = '/api/export/excel';
  };

  if (exportBtn1) exportBtn1.addEventListener('click', triggerExport);
  if (exportBtn2) exportBtn2.addEventListener('click', triggerExport);
}

/* ==========================================================================
   VIEW 4: Tasks View
   ========================================================================== */
function renderTasksView() {
  const tasksHtml = S.tasks.length === 0 ? `
    <div class="outreach-empty-state" style="margin:20px 0;">
      <div class="empty-icon" style="font-size:2.2rem; margin-bottom:4px;">✓</div>
      <h3 style="font-size:1.05rem; font-weight:600; color:var(--text-main); margin-bottom:4px;">All tasks completed</h3>
      <p style="color:var(--text-secondary); max-width:440px; font-size:0.86rem; line-height:1.5;">
        No pending action items right now. Add a task below or ask Copilot to extract tasks from your syllabus or job postings.
      </p>
    </div>
  ` : S.tasks.map(t => {
    const isDue = t.deadline ? countdownText(t.deadline) : '';
    const diff = daysUntil(t.deadline);
    const isUrgent = diff !== null && diff <= 2 && diff >= 0;

    return `
      <div class="task-item ${t.done ? 'done' : ''}" data-task-id="${t.id}">
        <div class="task-left">
          <input type="checkbox" class="task-checkbox" ${t.done ? 'checked' : ''} data-action="toggle-task" data-task-id="${t.id}">
          <span class="task-title">${escapeHtml(t.title)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          ${t.deadline ? `<span class="countdown-pill ${isUrgent ? 'urgent' : ''}">${isDue} (${formatDate(t.deadline)})</span>` : ''}
          <button class="btn btn-secondary btn-sm" data-action="delete-task" data-task-id="${t.id}">✕</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="list-container">
      <div class="quick-add-bar">
        <input type="text" id="quick-task-title" class="input-control" placeholder="Add a new task (e.g. Polish portfolio website)...">
        <input type="date" id="quick-task-date" class="input-control" style="width:160px;" value="${addDays(2)}">
        <button class="btn btn-primary" id="quick-task-add-btn">Add Task</button>
      </div>

      ${tasksHtml}
    </div>
  `;
}

function setupTasksListeners() {
  const addBtn = document.getElementById('quick-task-add-btn');
  const titleInput = document.getElementById('quick-task-title');
  const dateInput = document.getElementById('quick-task-date');

  if (addBtn && titleInput) {
    addBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) return;
      const deadline = dateInput ? dateInput.value : null;

      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, deadline })
      });
      playChime();
      titleInput.value = '';
      await fetchState();
    });
  }

  document.querySelectorAll('[data-action="toggle-task"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const taskId = cb.dataset.taskId;
      await fetch(`/api/tasks/${taskId}/done`, { method: 'POST' });
      playChime();
      await fetchState();
    });
  });

  document.querySelectorAll('[data-action="delete-task"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.taskId;
      await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      await fetchState();
    });
  });
}

/* ==========================================================================
   VIEW 5: Events & Talks View
   ========================================================================== */
function renderEventsView() {
  const eventsHtml = S.events.length === 0 ? `
    <div class="outreach-empty-state" style="margin:20px 0;">
      <div class="empty-icon" style="font-size:2.2rem; margin-bottom:4px;">🗓️</div>
      <h3 style="font-size:1.05rem; font-weight:600; color:var(--text-main); margin-bottom:4px;">No upcoming events scheduled</h3>
      <p style="color:var(--text-secondary); max-width:440px; font-size:0.86rem; line-height:1.5;">
        Track hackathons, workshops, and interview rounds. Copilot automatically coordinates reminders leading up to each event.
      </p>
      <button class="btn btn-primary btn-sm" id="btn-empty-add-event" style="margin-top:8px;">+ Schedule an event</button>
    </div>
  ` : S.events.map(e => {
    const countdown = countdownText(e.date);

    return `
      <div class="event-item" data-event-id="${e.id}">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <strong style="font-size:0.95rem; color:var(--text-main);">${escapeHtml(e.title)}</strong>
          <span style="font-size:0.8rem; color:var(--text-secondary);">
            🗓️ ${formatDate(e.date)} ${e.time ? '• ⏰ ' + e.time : ''}
          </span>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="countdown-pill">${countdown}</span>
          <button class="btn btn-secondary btn-sm" data-action="delete-event" data-event-id="${e.id}">✕</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="list-container">
      ${eventsHtml}
    </div>
  `;
}

function setupEventsListeners() {
  const addBtn = document.getElementById('btn-add-event-modal');
  if (addBtn) {
    addBtn.addEventListener('click', openAddEventModal);
  }

  const emptyAddBtn = document.getElementById('btn-empty-add-event');
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener('click', openAddEventModal);
  }

  document.querySelectorAll('[data-action="delete-event"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.eventId;
      await fetch(`/api/events/${id}`, { method: 'DELETE' });
      await fetchState();
    });
  });
}

function openAddEventModal() {
  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  modalRoot.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">Schedule Interview / Event</div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Event / Interview Title *</label>
          <input type="text" id="modal-event-title" class="input-control" placeholder="e.g. Microsoft Technical Round 1" required>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group">
            <label class="form-label">Date *</label>
            <input type="date" id="modal-event-date" class="input-control" value="${addDays(3)}">
          </div>
          <div class="form-group">
            <label class="form-label">Time (Optional)</label>
            <input type="time" id="modal-event-time" class="input-control" value="14:00">
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-event-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-event-save">Schedule Event</button>
      </div>
    </div>
  `;

  document.getElementById('modal-event-cancel').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });

  document.getElementById('modal-event-save').addEventListener('click', async () => {
    const title = document.getElementById('modal-event-title').value.trim();
    const date = document.getElementById('modal-event-date').value;
    const time = document.getElementById('modal-event-time').value;

    if (!title || !date) {
      showToast('Title and Date are required', '⚠️');
      return;
    }

    modalRoot.style.display = 'none';
    await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, date, time })
    });

    playChime();
    showToast('Event scheduled!', '✓');
    await fetchState();
  });
}

/* ==========================================================================
   VIEW 6: Calendar View
   ========================================================================== */
function renderCalendarView() {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const year = S.calYear;
  const month = S.calMonth;
  const today = todayIST();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Map dates to items
  const itemsByDate = {};
  S.opps.forEach(o => {
    if (o.deadline) {
      if (!itemsByDate[o.deadline]) itemsByDate[o.deadline] = [];
      itemsByDate[o.deadline].push({ type: 'opp', title: o.title, status: o.status });
    }
  });

  S.tasks.forEach(t => {
    if (t.deadline) {
      if (!itemsByDate[t.deadline]) itemsByDate[t.deadline] = [];
      itemsByDate[t.deadline].push({ type: 'task', title: t.title, done: t.done });
    }
  });

  S.events.forEach(e => {
    if (e.date) {
      if (!itemsByDate[e.date]) itemsByDate[e.date] = [];
      itemsByDate[e.date].push({ type: 'event', title: e.title, time: e.time });
    }
  });

  let cellsHtml = '';
  // Empty leading days
  for (let i = 0; i < firstDay; i++) {
    cellsHtml += `<div class="cal-cell" style="opacity:0.3;"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const curDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = curDateStr === today;
    const items = itemsByDate[curDateStr] || [];

    const pillsHtml = items.slice(0, 3).map(item => `
      <div class="cal-item-pill ${item.type}" title="${escapeHtml(item.title)}">
        ${item.type === 'opp' ? '🎯' : item.type === 'task' ? '📋' : '🗓️'} ${escapeHtml(item.title)}
      </div>
    `).join('');

    const moreText = items.length > 3 ? `<span style="font-size:0.65rem; color:var(--text-muted);">+${items.length - 3} more</span>` : '';

    cellsHtml += `
      <div class="cal-cell ${isToday ? 'today' : ''}" data-date="${curDateStr}">
        <div class="cal-cell-top">
          <span class="cal-day-num">${d}</span>
          ${items.length > 0 ? `<span style="width:6px; height:6px; border-radius:50%; background:var(--primary);"></span>` : ''}
        </div>
        <div class="cal-items-list">
          ${pillsHtml}
          ${moreText}
        </div>
      </div>
    `;
  }

  return `
    <div style="display:flex; flex-direction:column; height:100%;">
      <div class="cal-header-bar">
        <div style="display:flex; align-items:center; gap:12px;">
          <button class="btn btn-secondary btn-sm" id="cal-prev-btn">◀</button>
          <h3 style="font-size:1.15rem; font-weight:700;">${months[month]} ${year}</h3>
          <button class="btn btn-secondary btn-sm" id="cal-next-btn">▶</button>
        </div>
      </div>

      <div class="cal-month-grid">
        <div class="cal-cell-header">Sun</div>
        <div class="cal-cell-header">Mon</div>
        <div class="cal-cell-header">Tue</div>
        <div class="cal-cell-header">Wed</div>
        <div class="cal-cell-header">Thu</div>
        <div class="cal-cell-header">Fri</div>
        <div class="cal-cell-header">Sat</div>
        ${cellsHtml}
      </div>
    </div>
  `;
}

function setupCalendarListeners() {
  const prevBtn = document.getElementById('cal-prev-btn');
  const nextBtn = document.getElementById('cal-next-btn');
  const todayBtn = document.getElementById('cal-today-btn');

  if (prevBtn) prevBtn.addEventListener('click', () => {
    S.calMonth--;
    if (S.calMonth < 0) { S.calMonth = 11; S.calYear--; }
    renderActiveView();
  });

  if (nextBtn) nextBtn.addEventListener('click', () => {
    S.calMonth++;
    if (S.calMonth > 11) { S.calMonth = 0; S.calYear++; }
    renderActiveView();
  });

  if (todayBtn) todayBtn.addEventListener('click', () => {
    S.calYear = new Date().getFullYear();
    S.calMonth = new Date().getMonth();
    renderActiveView();
  });

  // Click day cell to view details
  document.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.date;
      showDayDetailsModal(dateStr);
    });
  });
}

function showDayDetailsModal(dateStr) {
  const opps = S.opps.filter(o => o.deadline === dateStr);
  const tasks = S.tasks.filter(t => t.deadline === dateStr);
  const events = S.events.filter(e => e.date === dateStr);

  const modalRoot = document.getElementById('modal-container');
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  let listHtml = '';
  if (opps.length === 0 && tasks.length === 0 && events.length === 0) {
    listHtml = `<p style="color:var(--text-muted);">No deadlines or events scheduled for this day.</p>`;
  } else {
    opps.forEach(o => {
      listHtml += `
        <div style="padding:8px 12px; background:var(--bg-surface); border-radius:var(--radius-sm); margin-bottom:6px;">
          🎯 <strong>${escapeHtml(o.title)}</strong> (${o.status})
        </div>
      `;
    });
    tasks.forEach(t => {
      listHtml += `
        <div style="padding:8px 12px; background:var(--bg-surface); border-radius:var(--radius-sm); margin-bottom:6px;">
          📋 <strong>${escapeHtml(t.title)}</strong> ${t.done ? '(Done)' : ''}
        </div>
      `;
    });
    events.forEach(e => {
      listHtml += `
        <div style="padding:8px 12px; background:var(--bg-surface); border-radius:var(--radius-sm); margin-bottom:6px;">
          🗓️ <strong>${escapeHtml(e.title)}</strong> ${e.time ? 'at ' + e.time : ''}
        </div>
      `;
    });
  }

  modalRoot.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">Schedule for ${formatDate(dateStr)}</div>
      <div class="modal-body">
        ${listHtml}
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="modal-day-close">Close</button>
      </div>
    </div>
  `;

  document.getElementById('modal-day-close').addEventListener('click', () => {
    modalRoot.style.display = 'none';
  });
}

/* ==========================================================================
   VIEW 7: Due Soon View
   ========================================================================== */
function renderDueSoonView() {
  const soonItems = [];

  S.opps.forEach(o => {
    if (o.deadline && o.status === 'pending') {
      const diff = daysUntil(o.deadline);
      if (diff !== null && diff <= 7) {
        soonItems.push({ ...o, kind: 'opp', diff });
      }
    }
  });

  S.tasks.forEach(t => {
    if (t.deadline && !t.done) {
      const diff = daysUntil(t.deadline);
      if (diff !== null && diff <= 7) {
        soonItems.push({ ...t, kind: 'task', diff });
      }
    }
  });

  soonItems.sort((a, b) => a.diff - b.diff);

  const itemsHtml = soonItems.length === 0 ? `
    <div class="outreach-empty-state" style="margin:20px 0;">
      <div class="empty-icon" style="font-size:2.2rem; margin-bottom:4px;">⏳</div>
      <h3 style="font-size:1.05rem; font-weight:600; color:var(--text-main); margin-bottom:4px;">You are all caught up</h3>
      <p style="color:var(--text-secondary); max-width:440px; font-size:0.86rem; line-height:1.5;">
        No immediate deadlines due in the next 7 days. Your upcoming applications and tasks are safely scheduled ahead.
      </p>
    </div>
  ` : soonItems.map(item => {
    const isOverdue = item.diff < 0;
    const isToday = item.diff === 0;

    return `
      <div class="task-item" style="border-left: 4px solid ${isOverdue ? 'var(--danger)' : isToday ? 'var(--warning)' : 'var(--primary)'};">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge ${item.kind === 'opp' ? 'badge-internship' : 'badge-assignment'}">${item.kind === 'opp' ? 'Opportunity' : 'Task'}</span>
            <strong style="color:var(--text-main); font-size:0.95rem;">${escapeHtml(item.title)}</strong>
          </div>
          <span style="font-size:0.8rem; color:var(--text-muted);">
            Deadline: ${formatDate(item.deadline)} (${countdownText(item.deadline)})
          </span>
        </div>
        <div>
          ${item.kind === 'opp' ? `
            <button class="btn btn-primary btn-sm" data-action="quick-applied" data-opp-id="${item.id}">Mark Applied</button>
          ` : `
            <button class="btn btn-success btn-sm" data-action="quick-done" data-task-id="${item.id}">Mark Done</button>
          `}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="list-container">
      ${itemsHtml}
    </div>
  `;
}

function setupDueSoonListeners() {
  document.querySelectorAll('[data-action="quick-applied"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const oppId = btn.dataset.oppId;
      await fetch(`/api/opportunities/${oppId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'applied' })
      });
      playChime();
      showToast('Marked as Applied! 🚀', '✓');
      await fetchState();
    });
  });

  document.querySelectorAll('[data-action="quick-done"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.taskId;
      await fetch(`/api/tasks/${taskId}/done`, { method: 'POST' });
      playChime();
      showToast('Task completed!', '✓');
      await fetchState();
    });
  });
}

/* ==========================================================================
   VIEW 8: Settings View (Rebuilt 4-Card Minimalist Layout)
   ========================================================================== */
function renderSettingsView() {
  const p = S.profile;
  const oppCount = S.opps.length;
  const taskCount = S.tasks.length;
  const eventCount = S.events.length;

  return `
    <div class="settings-grid">
      <!-- 1. Profile Card -->
      <div class="settings-card">
        <div class="settings-card-header">
          <span>👤</span>
          <h3>Profile & Aspirations</h3>
        </div>

        <div style="display:flex; align-items:center; gap:14px; margin-bottom:8px;">
          <div class="user-avatar" style="width:48px; height:48px; font-size:1.1rem;">
            ${(p.name || 'U').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div>
            <div style="font-weight:700; color:var(--text-main); font-size:1rem;">${escapeHtml(p.name || 'Set your name')}</div>
            <div style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(p.goal || 'Internships & Jobs')}</div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input type="text" id="set-prof-name" class="input-control" value="${escapeHtml(p.name || '')}" placeholder="Your full name">
        </div>

        <div class="form-group">
          <label class="form-label">Primary Career Goal</label>
          <select id="set-prof-goal" class="input-control">
            <option value="Internships & Jobs" ${p.goal === 'Internships & Jobs' ? 'selected' : ''}>Internships & Jobs</option>
            <option value="Hackathons & Competitions" ${p.goal === 'Hackathons & Competitions' ? 'selected' : ''}>Hackathons & Competitions</option>
            <option value="Scholarships & Grants" ${p.goal === 'Scholarships & Grants' ? 'selected' : ''}>Scholarships & Grants</option>
            <option value="Academics & Assignments" ${p.goal === 'Academics & Assignments' ? 'selected' : ''}>Academics & Assignments</option>
          </select>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group">
            <label class="form-label">College / University</label>
            <input type="text" id="set-prof-college" class="input-control" value="${escapeHtml(p.college || '')}" placeholder="e.g. IIT Delhi">
          </div>
          <div class="form-group">
            <label class="form-label">Major</label>
            <input type="text" id="set-prof-major" class="input-control" value="${escapeHtml(p.major || '')}" placeholder="e.g. Computer Science">
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group">
            <label class="form-label">Grad Year</label>
            <input type="text" id="set-prof-grad" class="input-control" value="${escapeHtml(p.grad_year || '')}" placeholder="e.g. 2027">
          </div>
          <div class="form-group">
            <label class="form-label">Target Role</label>
            <input type="text" id="set-prof-role" class="input-control" value="${escapeHtml(p.target_role || '')}" placeholder="e.g. SWE">
          </div>
        </div>

        <button class="btn btn-primary" id="set-save-profile-btn" style="margin-top:auto;">Save Profile Settings</button>
      </div>

      <!-- 2. Reminders Card -->
      <div class="settings-card">
        <div class="settings-card-header">
          <span>⏰</span>
          <h3>Proactive Reminders & Push</h3>
        </div>

        <div class="form-group">
          <label class="form-label">Alert Lead Time</label>
          <select id="set-lead-time" class="input-control">
            <option value="1" ${S.lead === 1 ? 'selected' : ''}>1 day before deadline</option>
            <option value="2" ${S.lead === 2 ? 'selected' : ''}>2 days before deadline</option>
            <option value="3" ${S.lead === 3 ? 'selected' : ''}>3 days before deadline (Recommended)</option>
            <option value="7" ${S.lead === 7 ? 'selected' : ''}>7 days before deadline</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Preferred Nudge Time</label>
          <select id="set-nudge-time" class="input-control">
            <option value="9:00 AM IST (Morning)" ${S.nudgeTime.includes('Morning') ? 'selected' : ''}>9:00 AM IST (Morning)</option>
            <option value="2:00 PM IST (Afternoon)" ${S.nudgeTime.includes('Afternoon') ? 'selected' : ''}>2:00 PM IST (Afternoon)</option>
            <option value="8:00 PM IST (Evening)" ${S.nudgeTime.includes('Evening') ? 'selected' : ''}>8:00 PM IST (Evening)</option>
          </select>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-top:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle);">
          <div>
            <div style="font-weight:600; font-size:0.88rem;">Audio Chime Feedback</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">Web Audio API confirmation tone</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <input type="checkbox" id="set-sound-cb" ${S.sound ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
            <button class="btn btn-secondary btn-sm" id="set-test-chime-btn">Test Chime</button>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="font-weight:600; font-size:0.88rem;">Web Push Notifications</div>
          <p style="font-size:0.78rem; color:var(--text-muted);">Receive background alerts via VAPID service worker before your deadlines expire.</p>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary btn-sm" id="btn-subscribe-push" style="flex:1;">Enable Push Notifications</button>
            <button class="btn btn-secondary btn-sm" id="btn-test-push">Send Test Push</button>
          </div>
        </div>
      </div>

      <!-- 3. Appearance Card -->
      <div class="settings-card">
        <div class="settings-card-header">
          <span>🎨</span>
          <h3>Appearance & Theme</h3>
        </div>

        <div class="theme-tiles-row">
          <div class="theme-tile ${S.theme === 'dark' ? 'active' : ''}" data-theme-val="dark">
            <div class="theme-tile-preview theme-preview-dark"></div>
            <span class="theme-tile-label">Dark</span>
          </div>

          <div class="theme-tile ${S.theme === 'light' ? 'active' : ''}" data-theme-val="light">
            <div class="theme-tile-preview theme-preview-light"></div>
            <span class="theme-tile-label">Light</span>
          </div>

          <div class="theme-tile ${S.theme === 'system' ? 'active' : ''}" data-theme-val="system">
            <div class="theme-tile-preview theme-preview-system"></div>
            <span class="theme-tile-label">System</span>
          </div>
        </div>
      </div>

      <!-- 4. Data Management Card -->
      <div class="settings-card">
        <div class="settings-card-header">
          <span>💾</span>
          <h3>Data & Database</h3>
        </div>

        <div class="counts-row">
          <div>
            <div class="count-col-num">${oppCount}</div>
            <div class="count-col-lbl">Opps</div>
          </div>
          <div>
            <div class="count-col-num">${taskCount}</div>
            <div class="count-col-lbl">Tasks</div>
          </div>
          <div>
            <div class="count-col-num">${eventCount}</div>
            <div class="count-col-lbl">Events</div>
          </div>
          <div>
            <div class="count-col-num">${S.msgs.length}</div>
            <div class="count-col-lbl">Messages</div>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px; margin-top:auto;">
          <button class="btn btn-secondary" id="set-load-demo-btn">
            Load Demo Data (Hackathons & Internships)
          </button>
          <button class="btn btn-danger" id="set-reset-btn">
            Reset Database & Clear All Data
          </button>
        </div>
      </div>
    </div>
  `;
}

function setupSettingsListeners() {
  // Save profile
  const saveProfBtn = document.getElementById('set-save-profile-btn');
  if (saveProfBtn) {
    saveProfBtn.addEventListener('click', async () => {
      const data = {
        name: document.getElementById('set-prof-name').value.trim(),
        goal: document.getElementById('set-prof-goal').value,
        college: document.getElementById('set-prof-college').value.trim(),
        major: document.getElementById('set-prof-major').value.trim(),
        grad_year: document.getElementById('set-prof-grad').value.trim(),
        target_role: document.getElementById('set-prof-role').value.trim()
      };

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (res.ok) {
        S.profile = await res.json();
        updateSidebarProfile();
        playChime();
        showToast('Profile updated successfully!', '✓');
      }
    });
  }

  // Chime test
  const testChimeBtn = document.getElementById('set-test-chime-btn');
  const soundCb = document.getElementById('set-sound-cb');
  if (testChimeBtn) {
    testChimeBtn.addEventListener('click', () => {
      playChime();
    });
  }
  if (soundCb) {
    soundCb.addEventListener('change', () => {
      S.sound = soundCb.checked;
    });
  }

  // Push notification subscribe
  const subBtn = document.getElementById('btn-subscribe-push');
  if (subBtn) {
    subBtn.addEventListener('click', async () => {
      await registerWebPush();
    });
  }

  const testPushBtn = document.getElementById('btn-test-push');
  if (testPushBtn) {
    testPushBtn.addEventListener('click', async () => {
      const res = await fetch('/api/push/test', { method: 'POST' });
      if (res.ok) {
        showToast('Dispatched test push notification', '🚀');
      } else {
        showToast('Could not dispatch test push', '⚠️');
      }
    });
  }

  // Theme tiles
  document.querySelectorAll('[data-theme-val]').forEach(tile => {
    tile.addEventListener('click', () => {
      const themeVal = tile.dataset.themeVal;
      applyTheme(themeVal);
    });
  });

  // Demo seed & Reset
  const seedBtn = document.getElementById('set-load-demo-btn');
  if (seedBtn) {
    seedBtn.addEventListener('click', async () => {
      await seedDemo();
    });
  }

  const resetBtn = document.getElementById('set-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to completely reset the application? All opportunities, messages, and settings will be cleared.')) {
        await fetch('/api/reset', { method: 'POST' });
        await fetchState();
        showToast('App reset complete', '✓');
      }
    });
  }
}

async function seedDemo() {
  const res = await fetch('/api/seed', { method: 'POST' });
  if (res.ok) {
    playChime();
    showToast('Loaded demo opportunities & tasks!', '🚀');
    await fetchState();
  }
}

function applyTheme(theme) {
  S.theme = theme;
  document.querySelectorAll('[data-theme-val]').forEach(t => {
    t.classList.toggle('active', t.dataset.themeVal === theme);
  });

  if (theme === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/* ==========================================================================
   Web Push Service Worker Registration
   ========================================================================== */
async function registerWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('Web Push not supported in this browser', '⚠️');
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Notification permission denied', '⚠️');
      return;
    }

    const keyRes = await fetch('/api/push/key');
    const { publicKey } = await keyRes.json();
    if (!publicKey) throw new Error('VAPID public key unavailable');

    const appServerKey = urlBase64ToUint8Array(publicKey);
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey
    });

    const subJson = sub.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: subJson.keys
      })
    });

    playChime();
    showToast('Push notifications successfully enabled!', '✓');
  } catch (err) {
    console.error('Push registration error:', err);
    showToast('Push registration failed', '⚠️');
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/* ==========================================================================
   Markdown Renderer & HTML Sanitizer
   ========================================================================== */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(text) {
  if (!text) return '';
  let str = escapeHtml(text);

  // Headers (### Header)
  str = str.replace(/^### (.*$)/gim, '<h4 style="margin:6px 0; font-size:1rem; font-weight:700;">$1</h4>');
  str = str.replace(/^## (.*$)/gim, '<h3 style="margin:8px 0; font-size:1.1rem; font-weight:700;">$1</h3>');

  // Bold (**bold**)
  str = str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic (*italic*)
  str = str.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Inline code (`code`)
  str = str.replace(/`(.*?)`/g, '<code>$1</code>');

  // Markdown lists
  str = str.replace(/^\s*•\s+(.*$)/gim, '<li style="margin-left:14px;">$1</li>');
  str = str.replace(/^\s*\*\s+(.*$)/gim, '<li style="margin-left:14px;">$1</li>');

  // Convert double newlines to paragraph breaks
  str = str.replace(/\n\n/g, '<br><br>');
  str = str.replace(/\n/g, '<br>');

  return str;
}

/* ==========================================================================
   Interactive Tour Walkthrough & Personalization
   ========================================================================== */
let tourCurrentStep = 1;
const TOUR_TOTAL_STEPS = 5;

function startInteractiveTour() {
  tourCurrentStep = 1;
  playChime();
  renderTourModal();
}

function renderTourModal() {
  const modalRoot = document.getElementById('modal-container');
  if (!modalRoot) return;
  modalRoot.style.display = 'flex';
  modalRoot.className = 'modal-backdrop';

  let stepBadge = `Step ${tourCurrentStep} of ${TOUR_TOTAL_STEPS}`;
  let title = '';
  let description = '';
  let canvasHtml = '';

  if (tourCurrentStep === 1) {
    title = '1. Drop Any Multimodal Input';
    description = 'Never waste time typing dates manually. Drop a website link, type colloquial text (<em>"remind me to apply for Google SWE next Friday"</em>), or <strong>Copy & Paste screenshot flyers directly with Ctrl+V</strong>!';
    canvasHtml = `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">TRY A SIMULATED INPUT IN THIS DUMMY BOX:</div>
        <div style="background:var(--bg-app); border:1px solid var(--border-strong); border-radius:var(--radius-md); padding:10px 12px; display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.85rem; color:var(--primary); font-family:var(--font-mono);">💬 Student:</span>
            <span style="font-size:0.88rem; color:var(--text-main);">"Google SWE Summer 2027 internship application deadline 24 Oct 2026"</span>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">
            <span class="badge badge-internship">📝 Natural text</span>
            <span class="badge badge-hackathon">📸 Ctrl+V Screenshot</span>
            <span class="badge badge-assignment">🔗 Web URL</span>
          </div>
        </div>
        <div style="font-size:0.75rem; color:var(--text-secondary); line-height:1.4;">
          💡 <strong>Pro-Tip:</strong> Take a screenshot using <code>Win + Shift + S</code>, click the Nudge typing box, and press <code>Ctrl + V</code>. The image will attach instantly!
        </div>
      </div>
    `;
  }

  else if (tourCurrentStep === 2) {
    title = '2. AI & Tesseract OCR Extraction';
    description = 'Nudge’s dual-layer engine runs image OCR tokens through Tesseract.js and scrapes webpage links with SSRF defense. It extracts organization, role, category, and the exact deadline stated on the source.';
    canvasHtml = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="border:1px dashed var(--primary); border-radius:var(--radius-md); padding:12px; background:var(--primary-subtle); display:flex; align-items:center; gap:12px;">
          <div style="font-size:2rem;">🖼️</div>
          <div style="font-size:0.82rem;">
            <strong style="color:var(--text-main); font-size:0.9rem;">Poster Flyer: Smart India Hackathon 2026</strong><br>
            <span style="color:var(--text-secondary);">"Organized by Ministry of Education. Final submission deadline: 28 Nov 2026."</span>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.8rem;">
          <div style="background:var(--bg-card); padding:8px 10px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
            <span style="color:var(--text-muted);">Extracted Org:</span> <strong style="color:var(--text-main);">Ministry of Education</strong>
          </div>
          <div style="background:var(--bg-card); padding:8px 10px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
            <span style="color:var(--text-muted);">Real Deadline:</span> <strong style="color:#10b981;">28 Nov 2026</strong>
          </div>
        </div>
      </div>
    `;
  }

  else if (tourCurrentStep === 3) {
    title = '3. The Interactive 2-Option Card';
    description = 'Instead of auto-writing unverified dates or forcing long forms, Nudge displays an inline interactive confirmation card:';
    canvasHtml = `
      <div style="background:var(--bg-card); border:1px solid var(--border-strong); border-radius:var(--radius-md); padding:14px; display:flex; flex-direction:column; gap:8px;">
        <div style="font-size:0.75rem; font-weight:700; color:var(--primary); text-transform:uppercase;">⚡ Interactive Confirmation Card</div>
        <div style="font-weight:700; color:var(--text-main); font-size:0.95rem;">Smart India Hackathon Finals 2026</div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:4px;">
          <!-- Option 1 -->
          <div style="background:var(--bg-surface); padding:10px; border-radius:var(--radius-sm); border:1px solid rgba(99,102,241,0.35); display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="font-size:0.72rem; font-weight:600; color:#10b981; margin-bottom:4px;">📸 Option 1: Extracted Date</div>
              <div style="display:flex; align-items:baseline; gap:6px; margin-bottom:6px;">
                <strong style="font-size:1.05rem; color:var(--text-main);">28 Nov 2026</strong>
                <span class="countdown-pill" style="font-size:0.7rem;">In 43d</span>
              </div>
              <div style="font-size:0.72rem; color:var(--text-muted); margin-bottom:8px;">Detected from flyer OCR</div>
            </div>
            <button class="btn btn-primary btn-sm" style="width:100%; font-size:0.75rem; padding:6px;" id="tour-demo-accept-btn">
              ✓ 1-Click Accept
            </button>
          </div>

          <!-- Option 2 -->
          <div style="background:var(--bg-surface); padding:10px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle); display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="font-size:0.72rem; font-weight:600; color:var(--text-muted); margin-bottom:6px;">🗓️ Option 2: Custom Date</div>
              <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
                <span class="preset-chip selected" style="padding:2px 6px; font-size:0.7rem;">Tomorrow</span>
                <span class="preset-chip" style="padding:2px 6px; font-size:0.7rem;">+3d</span>
                <span class="preset-chip" style="padding:2px 6px; font-size:0.7rem;">+7d</span>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" style="width:100%; font-size:0.75rem; padding:6px;" disabled>
              Pick from Mini-Cal
            </button>
          </div>
        </div>
      </div>
    `;
  }

  else if (tourCurrentStep === 4) {
    title = '4. Lifecycle Tracking & Proactive Alerts';
    description = 'Never lose track of your progress. Opportunities feature a 3-stage lifecycle (Pending ➔ Applied ➔ Rejected). Background minutely cron schedulers dispatch proactive Web Push notifications to your device before deadlines hit.';
    canvasHtml = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; gap:8px; justify-content:center;">
          <span class="status-badge status-pending" style="padding:6px 14px; font-size:0.85rem;">⏳ Pending (Preparing)</span>
          <span style="display:flex; align-items:center; color:var(--text-muted);">➔</span>
          <span class="status-badge status-applied" style="padding:6px 14px; font-size:0.85rem;">✓ Applied (Submitted)</span>
          <span style="display:flex; align-items:center; color:var(--text-muted);">➔</span>
          <span class="status-badge status-rejected" style="padding:6px 14px; font-size:0.85rem;">✕ Rejected</span>
        </div>
        <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:12px; display:flex; align-items:center; gap:12px;">
          <span style="font-size:1.6rem;">🔔</span>
          <div style="font-size:0.82rem;">
            <strong style="color:var(--text-main);">Push Notification Reminder:</strong><br>
            <span style="color:var(--text-secondary);">"Nudge: Smart India Hackathon deadline in 3 days (28 Nov 2026). Don't forget!"</span>
          </div>
        </div>
      </div>
    `;
  }

  else if (tourCurrentStep === 5) {
    title = '5. Reports & One-Click Excel Export';
    description = 'Assess your velocity with calculated conversion metrics, multi-segment progress bars, and one-click export of your complete dossier into formatted multi-sheet Excel spreadsheets (.xlsx).';
    canvasHtml = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:12px; display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">Conversion Rate</div>
            <div style="font-size:1.3rem; font-weight:800; color:#10b981;">67% Applied</div>
          </div>
          <button class="btn btn-primary btn-sm" id="tour-demo-excel-btn">
            📥 Download .xlsx Dossier
          </button>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); text-align:center;">
          ✓ Ready to take control of your deadlines? Click Finish to personalize your profile!
        </div>
      </div>
    `;
  }

  // Dots
  let dotsHtml = '';
  for (let i = 1; i <= TOUR_TOTAL_STEPS; i++) {
    dotsHtml += `<span class="tour-dot ${i === tourCurrentStep ? 'active' : ''}"></span>`;
  }

  modalRoot.innerHTML = `
    <div class="tour-modal-box">
      <div class="tour-top-bar">
        <span class="tour-pill">${stepBadge}</span>
        <div class="tour-dots-row">${dotsHtml}</div>
      </div>

      <div class="tour-header">
        <h3>${title}</h3>
        <p>${description}</p>
      </div>

      <div class="tour-dummy-canvas">
        ${canvasHtml}
      </div>

      <div class="tour-actions-footer">
        <button class="btn btn-secondary btn-sm" id="tour-btn-skip">
          Exit & Name Yourself ✍️
        </button>
        <div style="display:flex; gap:8px;">
          ${tourCurrentStep > 1 ? `
            <button class="btn btn-secondary btn-sm" id="tour-btn-prev">◀ Back</button>
          ` : ''}
          <button class="btn btn-primary btn-sm" id="tour-btn-next">
            ${tourCurrentStep === TOUR_TOTAL_STEPS ? 'Finish & Name Yourself 🚀' : 'Next Step ▶'}
          </button>
        </div>
      </div>
    </div>
  `;

  // Attach Tour Listeners
  const skipBtn = document.getElementById('tour-btn-skip');
  const prevBtn = document.getElementById('tour-btn-prev');
  const nextBtn = document.getElementById('tour-btn-next');
  const demoAcceptBtn = document.getElementById('tour-demo-accept-btn');
  const demoExcelBtn = document.getElementById('tour-demo-excel-btn');

  if (skipBtn) skipBtn.addEventListener('click', () => showPersonalizeModal());

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      tourCurrentStep--;
      renderTourModal();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (tourCurrentStep < TOUR_TOTAL_STEPS) {
        tourCurrentStep++;
        renderTourModal();
      } else {
        showPersonalizeModal();
      }
    });
  }

  if (demoAcceptBtn) {
    demoAcceptBtn.addEventListener('click', () => {
      playChime();
      showToast('Simulated 1-click confirmation accepted!', '✓');
      demoAcceptBtn.textContent = '✓ Confirmed (Simulated)';
      demoAcceptBtn.classList.remove('btn-primary');
      demoAcceptBtn.classList.add('btn-success');
    });
  }

  if (demoExcelBtn) {
    demoExcelBtn.addEventListener('click', () => {
      playChime();
      showToast('Exporting Excel spreadsheet...', '📥');
      window.location.href = '/api/export/excel';
    });
  }
}

function showPersonalizeModal() {
  const modalRoot = document.getElementById('modal-container');
  if (!modalRoot) return;

  const currentName = S.profile.name || '';
  const currentGoal = S.profile.goal || 'Internships & Jobs';
  const currentCollege = S.profile.college || '';
  const currentRole = S.profile.target_role || 'Software Engineer';

  modalRoot.innerHTML = `
    <div class="modal-box" style="animation: tourIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);">
      <div class="modal-title" style="display:flex; align-items:center; gap:8px;">
        <span>🎉</span>
        <span>Welcome! Personalize Your Copilot</span>
      </div>
      <div class="modal-body" style="margin-bottom:16px;">
        <p style="color:var(--text-secondary); margin-bottom:14px; font-size:0.88rem;">
          Tour complete! Tell us how to address you and what you're targeting so Nudge can tailor your experience:
        </p>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">What is your Name? *</label>
          <input type="text" id="tour-user-name" class="input-control" value="${escapeHtml(currentName)}" placeholder="e.g. Aryan Sharma" required autofocus>
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Primary Career Goal</label>
          <select id="tour-user-goal" class="input-control">
            <option value="Internships & Jobs" ${currentGoal === 'Internships & Jobs' ? 'selected' : ''}>Internships & Jobs</option>
            <option value="Hackathons & Competitions" ${currentGoal === 'Hackathons & Competitions' ? 'selected' : ''}>Hackathons & Competitions</option>
            <option value="Scholarships & Grants" ${currentGoal === 'Scholarships & Grants' ? 'selected' : ''}>Scholarships & Grants</option>
            <option value="Academics & Assignments" ${currentGoal === 'Academics & Assignments' ? 'selected' : ''}>Academics & Assignments</option>
          </select>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;">
          <div class="form-group">
            <label class="form-label">College / University</label>
            <input type="text" id="tour-user-college" class="input-control" value="${escapeHtml(currentCollege)}" placeholder="e.g. IIT Delhi">
          </div>
          <div class="form-group">
            <label class="form-label">Target Role</label>
            <input type="text" id="tour-user-role" class="input-control" value="${escapeHtml(currentRole)}" placeholder="e.g. Fullstack Engineer">
          </div>
        </div>
      </div>

      <div class="modal-actions" style="border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-secondary btn-sm" id="tour-personalize-skip">Keep Default</button>
        <button class="btn btn-primary" id="tour-personalize-save">Start Nudge on My Own 🚀</button>
      </div>
    </div>
  `;

  const nameInput = document.getElementById('tour-user-name');
  if (nameInput) {
    setTimeout(() => nameInput.focus(), 80);
  }

  const finishPersonalization = async (customName = null) => {
    const finalName = customName || (nameInput ? nameInput.value.trim() : '') || 'Applicant';
    const finalGoal = document.getElementById('tour-user-goal')?.value || 'Internships & Jobs';
    const finalCollege = document.getElementById('tour-user-college')?.value.trim() || '';
    const finalRole = document.getElementById('tour-user-role')?.value.trim() || 'Software Engineer';

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          goal: finalGoal,
          college: finalCollege,
          target_role: finalRole
        })
      });

      if (res.ok) {
        S.profile = await res.json();
      }
    } catch (e) {
      console.warn('Profile save warning:', e);
      S.profile.name = finalName;
      S.profile.goal = finalGoal;
    }

    modalRoot.style.display = 'none';
    updateSidebarProfile();
    playChime();
    showToast(`🎉 Welcome aboard, ${finalName}! Your copilot is active.`, '🚀', 4000);

    // Switch to chat view
    setView('chat');

    // Call personalized welcome endpoint
    if (S.convId) {
      try {
        await fetch('/api/welcome', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: finalName,
            conversation_id: S.convId
          })
        });
        await fetchMessages(S.convId);
        renderActiveView();
      } catch (err) {
        console.warn('Welcome message error:', err);
      }
    }
  };

  document.getElementById('tour-personalize-save')?.addEventListener('click', () => {
    finishPersonalization();
  });

  document.getElementById('tour-personalize-skip')?.addEventListener('click', () => {
    finishPersonalization(S.profile.name || 'Applicant');
  });
}

/* ==========================================================================
   Initialization
   ========================================================================== */
window.addEventListener('DOMContentLoaded', async () => {
  // Navigation tabs click listeners
  document.querySelectorAll('[data-view]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      setView(item.dataset.view);
    });
  });

  // Check URL query parameters (e.g. ?v=opps from notification click)
  const urlParams = new URLSearchParams(window.location.search);
  const initialView = urlParams.get('v');
  if (initialView && ['chat', 'opps', 'outreach', 'reports', 'tasks', 'events', 'cal', 'soon', 'set'].includes(initialView)) {
    S.view = initialView;
  }

  // Sidebar tour button
  document.getElementById('sidebar-tour-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    startInteractiveTour();
  });

  // Main Navigation Sidebar toggle controller (reserves space for chat / active view)
  const toggleSidebar = (force = null) => {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('btn-toggle-main-sidebar');
    if (!sidebar) return;
    const isCollapsed = force !== null ? force : !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', isCollapsed);
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', isCollapsed);
      toggleBtn.title = isCollapsed ? 'Expand Navigation Sidebar' : 'Collapse Navigation Sidebar (Reserve space for Chat)';
    }
    localStorage.setItem('nudge_sidebar_collapsed', isCollapsed ? 'true' : 'false');
  };

  // Restore saved sidebar collapsed state on startup
  const savedSidebarCollapsed = localStorage.getItem('nudge_sidebar_collapsed') === 'true';
  if (savedSidebarCollapsed) {
    toggleSidebar(true);
  }

  // Toggle buttons
  document.getElementById('btn-toggle-main-sidebar')?.addEventListener('click', () => toggleSidebar());
  document.getElementById('btn-collapse-sidebar')?.addEventListener('click', () => toggleSidebar());

  // Global Ctrl+B shortcut to toggle sidebar
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Register service worker silently for push notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW registration:', e));
  }

  await fetchState();
});
