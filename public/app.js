/**
 * app.js - Nudge Frontend Single Page Application
 * Zero build-step, vanilla ES6+, reactive state S
 */

// Global Reactive State
const S = {
  view: 'chat', // 'chat' | 'opps' | 'reports' | 'tasks' | 'events' | 'cal' | 'soon' | 'set'
  convId: null,
  convs: [],
  msgs: [],
  opps: [],
  tasks: [],
  events: [],
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

  const bOpps = document.getElementById('badge-opps');
  const bTasks = document.getElementById('badge-tasks');
  const bEvents = document.getElementById('badge-events');
  const bSoon = document.getElementById('badge-soon');

  if (bOpps) bOpps.textContent = pendingOpps;
  if (bTasks) bTasks.textContent = activeTasks;
  if (bEvents) bEvents.textContent = eventsCount;
  if (bSoon) bSoon.textContent = soonCount;
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

  switch (S.view) {
    case 'chat':
      titleEl.textContent = 'Copilot Assistant';
      subEl.textContent = 'Drop any link, poster flyer, or colloquial text to capture deadlines';
      actionsEl.innerHTML = `
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

/* ==========================================================================
   VIEW 1: Chat Assistant View
   ========================================================================== */
function renderChatView() {
  const msgsHtml = S.msgs.map(m => {
    let actionsObj = null;
    if (m.actions) {
      try {
        actionsObj = typeof m.actions === 'string' ? JSON.parse(m.actions) : m.actions;
      } catch (e) {}
    }

    let actionsHtml = '';
    if (actionsObj && actionsObj.type === 'deadline_card') {
      actionsHtml = renderDeadlineCard(actionsObj.item, m.id);
    } else if (actionsObj && actionsObj.type === 'duplicate_verify') {
      actionsHtml = renderDuplicateCard(actionsObj, m.id);
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

  return `
    <div id="chat-view-container">
      <div class="chat-history" id="chat-history-box">
        <!-- Hero Banner -->
        <div class="hero-card">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:8px; flex-wrap:wrap;">
            <div>
              <h3>Welcome to Nudge Copilot</h3>
              <p style="margin-bottom:0;">Drop a job link, paste a poster screenshot directly (<strong>Ctrl+V</strong>), or type colloquial text (<em>"remind me to apply for Google SWE next Friday"</em>). Nudge handles extraction, confirmation, and background reminders.</p>
            </div>
            <button class="btn btn-primary btn-sm" id="btn-hero-tour" style="box-shadow: 0 2px 8px var(--primary-glow); white-space:nowrap;">
              ✨ Start Tour (Dummy Demo)
            </button>
          </div>
          <div class="prompt-chips" style="margin-top:14px;">
            <button class="chip-btn" data-prompt="What's due this week?">📅 What's due this week?</button>
            <button class="chip-btn" data-prompt="Google Summer of Code application due 24 Oct 2026">💼 Google SSoC Application</button>
            <button class="chip-btn" data-prompt="Smart India Hackathon finals due next Friday">💻 Hackathon Deadline</button>
            <button class="chip-btn" data-prompt="Remind me to submit my Machine Learning assignment tomorrow">📝 Submit Assignment</button>
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
  `;
}

function renderDeadlineCard(item, msgId) {
  const suggested = item.suggested_deadline || item.deadline || addDays(3);
  const countdown = countdownText(suggested);

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

function renderDuplicateCard(dupObj, msgId) {
  const ex = dupObj.existing;
  const inc = dupObj.incoming;

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

    // 1. Check for image item in clipboard (e.g. Win+Shift+S or copied photo)
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

      if (act === 'accept_suggested') {
        const payload = {
          title: target.dataset.title,
          org: target.dataset.org,
          category: target.dataset.cat,
          deadline: target.dataset.deadline,
          location: target.dataset.loc,
          url: target.dataset.url
        };
        await executeCardAction('accept_suggested', payload);
      }

      else if (act === 'set_manual') {
        const msgId = target.dataset.msgTarget;
        const dateInput = document.getElementById(`manual-date-${msgId}`);
        const customDate = dateInput ? dateInput.value : todayIST();

        const payload = {
          title: target.dataset.title,
          org: target.dataset.org,
          category: target.dataset.cat,
          deadline: customDate,
          location: target.dataset.loc,
          url: target.dataset.url
        };
        await executeCardAction('set_manual', payload);
      }

      else if (act === 'dup_update') {
        const payload = {
          existingId: parseInt(target.dataset.exId, 10),
          deadline: target.dataset.deadline
        };
        await executeCardAction('dup_update', payload);
      }

      else if (act === 'dup_add_anyway') {
        const payload = {
          title: target.dataset.title,
          org: target.dataset.org,
          category: target.dataset.cat,
          deadline: target.dataset.deadline
        };
        await executeCardAction('dup_add_anyway', payload);
      }

      else if (act === 'dup_cancel') {
        await executeCardAction('dup_cancel', {});
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

async function executeCardAction(action, payload) {
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        payload,
        conversation_id: S.convId
      })
    });

    if (!res.ok) throw new Error('Action failed');
    const data = await res.json();

    playChime();
    showToast('Action confirmed!', '✓');

    if (data.state) {
      S.opps = data.state.opps || S.opps;
      S.tasks = data.state.tasks || S.tasks;
      S.events = data.state.events || S.events;
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
    <div style="grid-column: 1/-1; text-align:center; padding: 48px; color:var(--text-muted); background:var(--bg-card); border-radius:var(--radius-lg); border:1px solid var(--border-subtle);">
      <div style="font-size: 2.2rem; margin-bottom: 8px;">🎯</div>
      <h3>No opportunities found in this tab</h3>
      <p style="margin-top: 4px; font-size: 0.88rem;">Drop an internship link in the Chat Assistant or click "+ Add Opportunity" to get started.</p>
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
    <div style="text-align:center; padding:36px; color:var(--text-muted); background:var(--bg-card); border-radius:var(--radius-md);">
      No tasks yet! Add one below to stay ahead of deadlines.
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
    <div style="text-align:center; padding:36px; color:var(--text-muted); background:var(--bg-card); border-radius:var(--radius-md);">
      No scheduled events or interviews recorded yet.
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
    <div style="text-align:center; padding:48px; color:var(--text-muted); background:var(--bg-card); border-radius:var(--radius-lg);">
      <div style="font-size:2rem; margin-bottom:8px;">✨</div>
      <h3>You are all caught up!</h3>
      <p style="font-size:0.88rem; margin-top:4px;">No deadlines pending in the next 7 days.</p>
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
  if (initialView && ['chat', 'opps', 'reports', 'tasks', 'events', 'cal', 'soon', 'set'].includes(initialView)) {
    S.view = initialView;
  }

  // Sidebar tour button
  document.getElementById('sidebar-tour-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    startInteractiveTour();
  });

  // Register service worker silently for push notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW registration:', e));
  }

  await fetchState();
});
