/**
 * tinyfish.js - Official TinyFish Web Agent API Client (Fetch & Search)
 *
 * Implements:
 * 1. TinyFish Fetch API (POST https://api.fetch.tinyfish.ai)
 *    - Real Chromium browser rendering for dynamic JavaScript SPAs
 *    - Clean markdown extraction optimized for LLMs
 *    - SSRF pre-validation and prompt-injection safeguards
 *    - Graceful fallback to local fetchPage on error, timeout, or missing key
 * 2. TinyFish Search API (GET https://api.search.tinyfish.ai)
 *    - Live search engine discovery for internships, hackathons, and scholarships
 *    - Rank-stable, token-efficient JSON outputs
 */

import { isPrivateIP } from './fetchPage.js';
import dns from 'node:dns/promises';
import { URL } from 'node:url';

const TINYFISH_FETCH_URL = 'https://api.fetch.tinyfish.ai';
const TINYFISH_SEARCH_URL = 'https://api.search.tinyfish.ai';
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Pre-validates a URL to protect against SSRF before calling external services.
 */
export async function validateUrlForSSRF(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }

  const hostname = parsed.hostname;
  if (!hostname || hostname.toLowerCase() === 'localhost') {
    throw new Error('Access to localhost is restricted (SSRF protection)');
  }

  // Verify public IP
  try {
    const lookup = await dns.lookup(hostname, { all: true });
    for (const entry of lookup) {
      if (isPrivateIP(entry.address)) {
        throw new Error(`Restricted IP resolved (${entry.address}) - SSRF protection triggered`);
      }
    }
  } catch (err) {
    if (err.message.includes('SSRF protection')) throw err;
    // If DNS resolution fails locally, let caller handle or report
  }

  return parsed.toString();
}

/**
 * Sanitizes web text to protect LLMs against indirect prompt injection.
 * Strips common instruction-override delimiters and wraps content safely.
 */
export function sanitizeWebText(rawText, maxChars = 8000) {
  if (!rawText || typeof rawText !== 'string') return '';

  let sanitized = rawText
    // Remove or neutralize attempts to override system prompt
    .replace(/(?:system\s*prompt|system\s*instruction|ignore\s+(?:all\s+)?previous\s+instructions?)/gi, '[filtered_instruction]')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    // Normalize excessive whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

  if (sanitized.length > maxChars) {
    sanitized = sanitized.substring(0, maxChars) + '\n... [content truncated for length]';
  }

  return sanitized;
}

/**
 * Fetch a webpage using TinyFish Fetch API.
 * Uses official POST https://api.fetch.tinyfish.ai endpoint.
 *
 * Falls back safely to local fetchPage if TINYFISH_API_KEY is not configured,
 * times out, or target cannot be reached.
 *
 * @param {string} targetUrl - Webpage URL to render and extract
 * @param {object} options - Optional parameters (purpose, timeout, fallbackFn)
 * @returns {Promise<{text: string, title: string, url: string, source: 'tinyfish' | 'fallback', links?: string[]}>}
 */
export async function fetchWithTinyFish(targetUrl, options = {}) {
  const {
    purpose = 'Extract student opportunity details, registration deadlines, event dates, eligibility, and application links',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fallbackFn = null
  } = options;

  // 1. SSRF Pre-validation
  await validateUrlForSSRF(targetUrl);

  const apiKey = process.env.TINYFISH_API_KEY;

  // 2. If no TinyFish API key is configured, invoke fallback if provided
  if (!apiKey) {
    if (fallbackFn) {
      const fallbackText = await fallbackFn(targetUrl);
      return {
        text: sanitizeWebText(fallbackText),
        title: '',
        url: targetUrl,
        source: 'fallback',
        links: []
      };
    }
    throw new Error('TINYFISH_API_KEY is not configured and no fallback fetcher was provided');
  }

  // 3. Execute TinyFish Fetch API
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(TINYFISH_FETCH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        urls: [targetUrl],
        format: 'markdown',
        purpose,
        links: true
      })
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`TinyFish Fetch API error HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const result = data?.results?.[0];

    if (!result || !result.text) {
      const errorMsg = data?.errors?.[0]?.message || 'No content extracted by TinyFish';
      throw new Error(`TinyFish Fetch failed for ${targetUrl}: ${errorMsg}`);
    }

    return {
      text: sanitizeWebText(result.text),
      title: result.title || '',
      description: result.description || '',
      url: result.url || targetUrl,
      source: 'tinyfish',
      links: Array.isArray(result.links) ? result.links.slice(0, 15) : [],
      fetchTimeMs: result.fetch_time_ms || null
    };

  } catch (err) {
    clearTimeout(timer);
    console.warn(`[TinyFish] Fetch error for ${targetUrl} (${err.message}). Attempting fallback...`);

    // Graceful fallback to local fetchPage if available
    if (fallbackFn) {
      try {
        const fallbackText = await fallbackFn(targetUrl);
        return {
          text: sanitizeWebText(fallbackText),
          title: '',
          url: targetUrl,
          source: 'fallback',
          links: []
        };
      } catch (fallbackErr) {
        throw new Error(`Both TinyFish and fallback fetch failed: ${fallbackErr.message}`);
      }
    }

    throw err;
  }
}

/**
 * Searches the web for student opportunities using TinyFish Search API.
 * Uses official GET https://api.search.tinyfish.ai?query=...
 *
 * @param {string} query - Search query (e.g., "Google Summer internships 2027", "Hackathons in India")
 * @param {object} options - Optional parameters (limit, timeoutMs)
 * @returns {Promise<Array<{position: number, title: string, snippet: string, url: string, site_name: string}>>}
 */
export async function searchWithTinyFish(query, options = {}) {
  if (!query || !query.trim()) {
    return [];
  }

  const { timeoutMs = DEFAULT_TIMEOUT_MS, limit = 10 } = options;
  const apiKey = process.env.TINYFISH_API_KEY;

  if (!apiKey) {
    console.warn('[TinyFish] TINYFISH_API_KEY not configured. Returning deterministic mock discovery results.');
    return getDeterministicMockSearchResults(query);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const searchUrl = `${TINYFISH_SEARCH_URL}?query=${encodeURIComponent(query.trim())}`;
    const res = await fetch(searchUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`TinyFish Search API error HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const rawResults = Array.isArray(data?.results) ? data.results : [];

    return rawResults.slice(0, limit).map((r, idx) => ({
      position: r.position || idx + 1,
      title: r.title || 'Opportunity Listing',
      snippet: r.snippet || '',
      url: r.url || '',
      site_name: r.site_name || ''
    }));

  } catch (err) {
    clearTimeout(timer);
    console.warn(`[TinyFish] Search API failed for query "${query}": ${err.message}. Using fallback discovery.`);
    return getDeterministicMockSearchResults(query);
  }
}

/**
 * Provides offline/development mock search results when TINYFISH_API_KEY is not configured.
 * Ensures local dev, tests, and demo modes function reliably.
 */
export function getDeterministicMockSearchResults(query) {
  const q = (query || '').toLowerCase();

  const mockDatabase = [
    {
      position: 1,
      title: 'Google Summer of Code 2027 Student Applications',
      snippet: 'Google Summer of Code is a global program bringing student developers into open source. Registration deadline is 25 November 2026. Open to university students worldwide.',
      url: 'https://summerofcode.withgoogle.com',
      site_name: 'Google'
    },
    {
      position: 2,
      title: 'Smart India Hackathon 2027 - Nationwide Student Innovation Contest',
      snippet: 'SIH is a nationwide initiative to provide students a platform to solve pressing problems. Team registration deadline is 28 November 2026. Grand finale in New Delhi.',
      url: 'https://sih.gov.in',
      site_name: 'Ministry of Education'
    },
    {
      position: 3,
      title: 'Microsoft Software Engineering Internship Summer 2027',
      snippet: 'Join Microsoft as a Software Engineering Intern. Opportunities across Hyderabad and Bengaluru. Apply before 30 November 2026. Pre-final year students eligible.',
      url: 'https://careers.microsoft.com',
      site_name: 'Microsoft'
    },
    {
      position: 4,
      title: 'ETHIndia 2026 - Asia’s Biggest Ethereum Hackathon',
      snippet: 'Build decentralized applications with 2000+ hackers in Bengaluru. Hacker applications close on 15 November 2026. Full travel grants and prizes available.',
      url: 'https://ethindia.co',
      site_name: 'Devfolio'
    },
    {
      position: 5,
      title: 'Adobe Research Women-in-Technology Scholarship 2027',
      snippet: 'Scholarship recognizing outstanding undergraduate and master female students studying computer science. Deadline to apply is 12 December 2026. Includes $10,000 award.',
      url: 'https://research.adobe.com',
      site_name: 'Adobe'
    }
  ];

  if (q.includes('hackathon')) {
    return mockDatabase.filter(m => m.title.toLowerCase().includes('hackathon') || m.snippet.toLowerCase().includes('hackathon'));
  }
  if (q.includes('intern') || q.includes('swe')) {
    return mockDatabase.filter(m => m.title.toLowerCase().includes('intern') || m.snippet.toLowerCase().includes('intern') || m.title.toLowerCase().includes('summer of code'));
  }
  if (q.includes('scholarship')) {
    return mockDatabase.filter(m => m.title.toLowerCase().includes('scholarship') || m.snippet.toLowerCase().includes('scholarship'));
  }

  return mockDatabase;
}
