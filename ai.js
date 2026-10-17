/**
 * ai.js - AI extraction engine supporting Gemini/Gemma API, Tesseract OCR, and offline heuristic fallback
 */
import { createWorker } from 'tesseract.js';
import { todayIST, parseColloquialDate, formatDateIST, extractDeadlineFromContext } from './dates.js';
import { fetchPage } from './fetchPage.js';

let ocrWorker = null;

/**
 * Initializes and returns a cached Tesseract worker instance
 */
async function getOCRWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker('eng');
  }
  return ocrWorker;
}

/**
 * Perform OCR on image buffer or base64 string
 */
export async function performOCR(imageInput) {
  if (!imageInput) return '';
  try {
    const worker = await getOCRWorker();
    let imgBuffer = imageInput;

    if (typeof imageInput === 'string') {
      // Strip data URI prefix if present
      const base64Data = imageInput.replace(/^data:image\/\w+;base64,/, '');
      imgBuffer = Buffer.from(base64Data, 'base64');
    }

    const ret = await worker.recognize(imgBuffer);
    return ret?.data?.text?.trim() || '';
  } catch (err) {
    console.error('Tesseract OCR Error:', err.message);
    return '';
  }
}

/**
 * Extract URL from text if present
 */
export function extractUrlFromText(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"'{}|\\^`\[\]]+/i);
  return match ? match[0] : null;
}

/**
 * Main prompt processing pipeline:
 * Takes raw text, optional image, and processes through LLM or heuristic fallback.
 */
export async function processUserInput({ text = '', image = null, existingItems = [] }) {
  const today = todayIST();
  let pageText = '';
  let fetchedUrl = extractUrlFromText(text);

  // 1. Fetch web page if URL found
  if (fetchedUrl) {
    try {
      pageText = await fetchPage(fetchedUrl);
    } catch (err) {
      console.warn(`Could not fetch page ${fetchedUrl}:`, err.message);
    }
  }

  // 2. Perform OCR if image provided
  let ocrText = '';
  if (image) {
    try {
      ocrText = await performOCR(image);
    } catch (err) {
      console.warn('OCR processing failed:', err.message);
    }
  }

  // 3. Check for API key (Gemini/Gemma)
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const aiMode = process.env.AI_MODE || (apiKey ? 'production' : 'mock');

  if (aiMode === 'production' && apiKey) {
    try {
      const llmResult = await callGeminiAPI({ text, ocrText, pageText, image, today, url: fetchedUrl });
      if (llmResult) return llmResult;
    } catch (err) {
      console.error('Gemini API call failed, falling back to heuristic parser:', err.message);
    }
  }

  // Fallback to Heuristic Rule-Based Parser
  return parseHeuristically({ text, ocrText, pageText, url: fetchedUrl, today });
}

/**
 * Calls Gemini / Gemma API for structured extraction
 */
async function callGeminiAPI({ text, ocrText, pageText, image, today, url }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const systemInstructions = `
You are Nudge, an expert AI student deadline and opportunity copilot.
Current Date in India Standard Time (IST): ${today}

Your goal: Extract structured opportunities, tasks, events, or answer queries from untrusted user inputs.
UNTRUSTED USER INPUT:
- Text: """${text}"""
- URL: """${url || 'None'}"""
- Page Content: """${pageText ? pageText.substring(0, 3000) : 'None'}"""
- Image OCR Tokens: """${ocrText ? ocrText.substring(0, 2000) : 'None'}"""

CRITICAL EXTRACTION RULES:
1. NEVER Hallucinate Deadlines: If no deadline is explicitly mentioned or deducible, "deadline" must be null and "evidence" must be "none".
2. Convert all relative dates ("tomorrow", "next Friday", "in 5 days") to absolute YYYY-MM-DD relative to today (${today}).
3. Categories must be one of: "internship", "hackathon", "scholarship", "assignment", "event", "form", "other".
4. Intents must be one of: "save_opportunity", "add_task", "add_event", "ask_deadlines", "provide_deadline", "chitchat", "unclear".
5. Return ONLY a valid JSON object strictly matching this schema:
{
  "intent": "save_opportunity | add_task | add_event | ask_deadlines | provide_deadline | chitchat | unclear",
  "items": [
    {
      "title": "string",
      "org": "string | null",
      "category": "internship | hackathon | scholarship | assignment | event | form | other",
      "deadline": "YYYY-MM-DD | null",
      "evidence": "text | image | page | none",
      "location": "string | null",
      "time": "HH:MM | null"
    }
  ],
  "needs_clarification": false,
  "question": null
}
`;

  const parts = [{ text: systemInstructions }];

  if (image && typeof image === 'string') {
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      parts.push({
        inline_data: {
          mime_type: match[1],
          data: match[2]
        }
      });
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${errText}`);
  }

  const json = await response.json();
  const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  return JSON.parse(rawText);
}

/**
 * Heuristic Offline Parser for Dev/Mock mode and fallback
 */
export function parseHeuristically({ text = '', ocrText = '', pageText = '', url = null, today = todayIST() }) {
  const combined = `${text} ${ocrText} ${pageText}`.trim();
  const lowerText = text.toLowerCase().trim();
  const lowerCombined = combined.toLowerCase();

  // 1. Detect Direct Queries (ask_deadlines)
  if (
    /^(what('?s| is) (due|upcoming|on my schedule)|any deadlines|show (my )?(deadlines|tasks|calendar)|due this week|what do i have)/i.test(lowerText) ||
    (lowerText.includes('deadline') && (lowerText.startsWith('what') || lowerText.startsWith('show') || lowerText.startsWith('list')))
  ) {
    return {
      intent: 'ask_deadlines',
      items: [],
      needs_clarification: false,
      question: null
    };
  }

  // 2. Detect Chitchat / Greetings
  if (/^(hi|hello|hey|greetings|who are you|what can you do|help)\b/i.test(lowerText) && lowerText.length < 35) {
    return {
      intent: 'chitchat',
      items: [],
      needs_clarification: false,
      question: null
    };
  }

  // 3. Detect Provide Deadline (standalone date input)
  const standAloneDate = parseColloquialDate(lowerText);
  if (standAloneDate && lowerText.split(/\s+/).length <= 5 && !/(internship|hackathon|apply|submit|remind|interview)/i.test(lowerText)) {
    return {
      intent: 'provide_deadline',
      items: [{
        title: 'Provided Date',
        org: null,
        category: 'other',
        deadline: standAloneDate,
        evidence: 'text',
        location: null,
        time: null
      }],
      needs_clarification: false,
      question: null
    };
  }

  // 4. Detect Category
  let category = 'other';
  if (/hackathon|codefest|hack\b|ideathon/i.test(lowerCombined)) {
    category = 'hackathon';
  } else if (/intern|internship|co-op|summer analyst|campus hiring/i.test(lowerCombined)) {
    category = 'internship';
  } else if (/scholarship|fellowship|grant|bursary/i.test(lowerCombined)) {
    category = 'scholarship';
  } else if (/assignment|homework|essay|lab report|quiz|project submission/i.test(lowerCombined)) {
    category = 'assignment';
  } else if (/interview|webinar|workshop|meetup|talk|session/i.test(lowerCombined)) {
    category = 'event';
  } else if (/form|survey|rsvp|nomination/i.test(lowerCombined)) {
    category = 'form';
  }

  // 5. Extract Organization
  let org = null;
  const knownOrgs = [
    'Google', 'Microsoft', 'Amazon', 'Meta', 'Apple', 'Devfolio', 'MLH', 'Major League Hacking',
    'Adobe', 'Goldman Sachs', 'Uber', 'Netflix', 'Atlassian', 'Morgan Stanley', 'IIT Delhi',
    'IIT Bombay', 'IIT Madras', 'NIT', 'Ministry of Education', 'Smart India Hackathon',
    'GitHub', 'OpenAI', 'Anthropic', 'Stripe', 'Spotify', 'NVIDIA', 'Intel', 'Salesforce'
  ];

  for (const ko of knownOrgs) {
    if (new RegExp(`\\b${ko}\\b`, 'i').test(combined)) {
      org = ko;
      break;
    }
  }

  if (!org) {
    // Regex heuristics for "at Company", "from Company", "by Company"
    const atMatch = text.match(/\b(?:at|with|by|from)\s+([A-Z][a-zA-Z0-9&]+(?:\s+[A-Z][a-zA-Z0-9&]+)?)\b/);
    if (atMatch && !['Google', 'Home', 'Night', 'Today', 'Tomorrow', 'Monday', 'Friday'].includes(atMatch[1])) {
      org = atMatch[1];
    }
  }

  // 6. Extract Deadline Date
  let deadline = null;
  let evidence = 'none';

  // 6a. If image OCR text is present, extract directly from photo/flyer tokens
  if (ocrText) {
    const ocrDate = extractDeadlineFromContext(ocrText);
    if (ocrDate) {
      deadline = ocrDate;
      evidence = 'image';
    }
  }

  // 6b. If web page text is present, extract directly from site listing
  if (!deadline && pageText) {
    const pageDate = extractDeadlineFromContext(pageText);
    if (pageDate) {
      deadline = pageDate;
      evidence = 'page';
    }
  }

  // 6c. If not found in photo/page, extract from user natural language text
  if (!deadline && text) {
    const textDate = extractDeadlineFromContext(text);
    if (textDate) {
      deadline = textDate;
      evidence = 'text';
    }
  }

  // 7. Extract Time (HH:MM)
  let time = null;
  const timeMatch = combined.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b/i) || combined.match(/\b([1-9]|1[0-2])\s*(am|pm)\b/i);
  if (timeMatch) {
    if (timeMatch[3] || timeMatch[2]) {
      const isPm = /pm/i.test(timeMatch[0]);
      let hour = parseInt(timeMatch[1], 10);
      const min = timeMatch[2] && !isNaN(parseInt(timeMatch[2], 10)) ? timeMatch[2] : '00';
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
      time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    } else {
      time = `${String(timeMatch[1]).padStart(2, '0')}:${timeMatch[2]}`;
    }
  }

  // 8. Extract Title
  let title = 'Opportunity';
  if (category === 'assignment' || lowerText.startsWith('remind me') || lowerText.startsWith('todo:') || lowerText.startsWith('task:')) {
    let clean = text.replace(/^(remind me to|remind me|todo:|task:)\s*/i, '').trim();
    // remove trailing date expressions
    clean = clean.replace(/\b(next\s+\w+|tomorrow|today|this\s+\w+|in\s+\d+\s+days?)\b/gi, '').trim();
    title = clean.charAt(0).toUpperCase() + clean.slice(1) || 'Class Assignment';
  } else if (category === 'event' || /interview|webinar/i.test(lowerText)) {
    title = (org ? `${org} ` : '') + (text.match(/(interview|webinar|workshop|meetup|talk)/i)?.[0] || 'Event');
    title = title.charAt(0).toUpperCase() + title.slice(1);
  } else if (org) {
    const roleMatch = combined.match(/\b(SWE|Software Engineer|Product Manager|Data Analyst|Frontend|Backend|Fullstack|Developer|Research Fellow|Campus Ambassador)\b/i);
    const role = roleMatch ? roleMatch[0] : (category === 'hackathon' ? 'Hackathon' : 'Opportunity');
    title = `${org} ${role}`;
  } else if (ocrText) {
    const firstLine = ocrText.split('\n').map(l => l.trim()).filter(Boolean)[0];
    if (firstLine && firstLine.length < 60) {
      title = firstLine;
    }
  } else if (text) {
    const words = text.split(/\s+/).slice(0, 7).join(' ');
    title = words.charAt(0).toUpperCase() + words.slice(1);
  }

  // Check if message is legitimately related to Nudge (opportunity, task, event, deadline)
  const isImageOrPagePresent = Boolean(ocrText || pageText || url);
  const hasExtractedDate = Boolean(deadline);
  const hasExplicitOrg = Boolean(org);
  const isAssignmentOrTask = category === 'assignment' || lowerText.startsWith('remind me') || lowerText.startsWith('todo:') || lowerText.startsWith('task:') || /\b(submit|assignment|homework|essay|finish|complete|due|deadline|task|todo)\b/i.test(lowerText);
  const isEvent = category === 'event' || /\b(interview|webinar|workshop|meetup|talk|session)\b/i.test(lowerText);
  const isOpportunity = ['internship', 'hackathon', 'scholarship', 'form'].includes(category) || /\b(intern|internship|hackathon|scholarship|fellowship|job|hiring|careers?|co-op|swe|developer|application|apply|contest|fellow)\b/i.test(lowerCombined);

  const isRelevant = isImageOrPagePresent || hasExtractedDate || hasExplicitOrg || isAssignmentOrTask || isEvent || isOpportunity;

  if (!isRelevant) {
    return {
      intent: 'irrelevant',
      items: [],
      needs_clarification: false,
      question: null
    };
  }

  // Determine intent
  let intent = 'save_opportunity';
  if (isAssignmentOrTask) {
    intent = 'add_task';
  } else if (isEvent) {
    intent = 'add_event';
  }

  return {
    intent,
    items: [
      {
        title: title || 'Opportunity',
        org,
        category,
        deadline,
        evidence,
        location: /remote/i.test(combined) ? 'Remote' : null,
        time
      }
    ],
    needs_clarification: false,
    question: null
  };
}
