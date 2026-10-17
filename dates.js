/**
 * dates.js - Timezone calculations & date utilities for Nudge (IST / Asia/Kolkata)
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30 in ms

/**
 * Returns current Date in IST
 */
export function getISTDate(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + IST_OFFSET_MS);
}

/**
 * Returns today's date formatted as YYYY-MM-DD in IST
 */
export function todayIST() {
  const d = getISTDate();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats YYYY-MM-DD into "24 Oct 2026"
 */
export function formatDateIST(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const d = new Date(year, month, day);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[month]} ${year}`;
}

/**
 * Calculates days remaining from todayIST() until dateStr (YYYY-MM-DD).
 * Returns integer: >0 future, 0 today, <0 overdue.
 */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = todayIST();
  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = dateStr.split('-').map(Number);

  const dt1 = new Date(Date.UTC(y1, m1 - 1, d1));
  const dt2 = new Date(Date.UTC(y2, m2 - 1, d2));
  const diffMs = dt2.getTime() - dt1.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Returns countdown text e.g. "In 9 days", "Tomorrow", "Today", "Overdue by 2 days"
 */
export function countdownText(dateStr) {
  const diff = daysUntil(dateStr);
  if (diff === null) return '';
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday (Overdue)';
  if (diff < -1) return `Overdue by ${Math.abs(diff)} days`;
  return `In ${diff} days`;
}

/**
 * Adds offset days to a given YYYY-MM-DD (or todayIST if omitted)
 */
export function addDays(days, baseDateStr = null) {
  const base = baseDateStr || todayIST();
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(dt.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

/**
 * Parse colloquial relative date from text relative to todayIST
 */
export function parseColloquialDate(rawText) {
  if (!rawText) return null;
  const text = rawText.toLowerCase().trim();
  const today = todayIST();

  if (/\b(today|tonight)\b/.test(text)) {
    return today;
  }
  if (/\btomorrow\b/.test(text)) {
    return addDays(1, today);
  }
  if (/\bday after tomorrow\b/.test(text)) {
    return addDays(2, today);
  }

  // in X days / X days from now
  const inDaysMatch = text.match(/\bin\s+(\d+)\s+days?\b/) || text.match(/(\d+)\s+days?\s+(from\s+now|later)/);
  if (inDaysMatch) {
    return addDays(parseInt(inDaysMatch[1], 10), today);
  }

  // in a week / in 1 week / next week
  if (/\b(in\s+a\s+week|in\s+1\s+week)\b/.test(text)) {
    return addDays(7, today);
  }
  if (/\bin\s+(\d+)\s+weeks?\b/.test(text)) {
    const w = parseInt(text.match(/\bin\s+(\d+)\s+weeks?\b/)[1], 10);
    return addDays(w * 7, today);
  }

  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const [curY, curM, curD] = today.split('-').map(Number);
  const curDt = new Date(Date.UTC(curY, curM - 1, curD));
  const currentDayIndex = curDt.getUTCDay();

  // "this Friday", "next Friday", "Friday"
  for (let i = 0; i < daysOfWeek.length; i++) {
    const dow = daysOfWeek[i];
    if (new RegExp(`\\b(this|next)?\\s*${dow}\\b`).test(text)) {
      const isNext = new RegExp(`\\bnext\\s+${dow}\\b`).test(text);
      let diff = i - currentDayIndex;
      if (diff <= 0) {
        diff += 7;
      }
      if (isNext && diff < 7) {
        diff += 7;
      }
      return addDays(diff, today);
    }
  }

  // Month day formats like "24 Oct", "October 24", "24/10/2026", "2026-10-24"
  // ISO match
  const isoMatch = text.match(/\b(\d{4})[\/\.\-](\d{2})[\/\.\-](\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY or with 2-digit year
  const slashMatch = text.match(/\b(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})\b/);
  if (slashMatch) {
    let p1 = parseInt(slashMatch[1], 10);
    let p2 = parseInt(slashMatch[2], 10);
    let rawY = slashMatch[3];
    let y = rawY.length === 2 ? `20${rawY}` : rawY;

    // Disambiguate DD/MM vs MM/DD: If p1 > 12 and p2 <= 12 -> DD/MM
    // If p2 > 12 and p1 <= 12 -> MM/DD
    let d, m;
    if (p1 > 12 && p2 <= 12) {
      d = String(p1).padStart(2, '0');
      m = String(p2).padStart(2, '0');
    } else if (p2 > 12 && p1 <= 12) {
      m = String(p1).padStart(2, '0');
      d = String(p2).padStart(2, '0');
    } else {
      // Default to DD/MM/YYYY (Indian/UK Standard)
      d = String(p1).padStart(2, '0');
      m = String(p2).padStart(2, '0');
    }
    return `${y}-${m}-${d}`;
  }

  // "24 Oct", "24 October", "Oct 24", "October 24" optionally with year
  const monthNames = [
    { name: 'jan', num: '01' }, { name: 'feb', num: '02' }, { name: 'mar', num: '03' },
    { name: 'apr', num: '04' }, { name: 'may', num: '05' }, { name: 'jun', num: '06' },
    { name: 'jul', num: '07' }, { name: 'aug', num: '08' }, { name: 'sep', num: '09' },
    { name: 'oct', num: '10' }, { name: 'nov', num: '11' }, { name: 'dec', num: '12' }
  ];

  for (const m of monthNames) {
    // "24 Oct 2026" or "24 Oct" or "24th Oct"
    const reg1 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${m.name}\\w*(?:\\s*,?\\s*(\\d{2,4}))?\\b`, 'i');
    const match1 = text.match(reg1);
    if (match1) {
      const d = String(match1[1]).padStart(2, '0');
      let rawY = match1[2];
      let y = rawY ? (rawY.length === 2 ? `20${rawY}` : rawY) : String(curY);
      return `${y}-${m.num}-${d}`;
    }

    // "Oct 24, 2026" or "Oct 24"
    const reg2 = new RegExp(`\\b${m.name}\\w*\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{2,4}))?\\b`, 'i');
    const match2 = text.match(reg2);
    if (match2) {
      const d = String(match2[1]).padStart(2, '0');
      let rawY = match2[2];
      let y = rawY ? (rawY.length === 2 ? `20${rawY}` : rawY) : String(curY);
      return `${y}-${m.num}-${d}`;
    }
  }

  return null;
}

/**
 * Extracts best deadline date from unstructured context (flyers, OCR, web pages),
 * prioritizing proximity to deadline-indicating keywords before general date search.
 */
export function extractDeadlineFromContext(text) {
  if (!text) return null;

  const keywords = [
    'registration deadline', 'submission deadline', 'application deadline',
    'last date to apply', 'last date of application', 'last date of submission',
    'last date', 'last day', 'deadline', 'due date', 'due on', 'due by',
    'apply by', 'apply before', 'apply until', 'closes on', 'closing date',
    'close date', 'ends on', 'end date', 'register before', 'register by',
    'submit before', 'submit by', 'important dates', 'timeline'
  ];

  const lower = text.toLowerCase();

  // 1. Proximity search around keywords
  for (const kw of keywords) {
    let searchStart = 0;
    while (searchStart < lower.length) {
      const idx = lower.indexOf(kw, searchStart);
      if (idx === -1) break;

      const windowStart = Math.max(0, idx - 40);
      const windowEnd = Math.min(text.length, idx + kw.length + 120);
      const snippet = text.slice(windowStart, windowEnd);
      const found = parseColloquialDate(snippet);
      if (found) {
        return found;
      }
      searchStart = idx + kw.length;
    }
  }

  // 2. Fallback to scanning lines in reverse or from top
  const lines = text.split(/[\r\n]+/);
  for (const line of lines) {
    const found = parseColloquialDate(line);
    if (found) return found;
  }

  return parseColloquialDate(text);
}
