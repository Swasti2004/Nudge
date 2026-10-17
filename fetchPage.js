/**
 * fetchPage.js - SSRF-safe web page content fetcher and cleaner
 */
import dns from 'node:dns/promises';
import { URL } from 'node:url';

/**
 * Checks if an IP string belongs to a private, loopback, or link-local range.
 */
export function isPrivateIP(ip) {
  if (!ip) return true;

  // IPv6 check
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }

  // IPv4 mapped IPv6 (e.g., ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return true; // Not a valid IPv4 address
  }

  const [a, b] = parts;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 172.16.0.0/12 (Private: 172.16 - 172.31)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 169.254.0.0/16 (Link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 (Broadcast/Current network)
  if (a === 0) return true;

  return false;
}

/**
 * Fetches and cleans HTML from a URL with SSRF protection and a 6s timeout.
 * Returns truncated clean plain text (max 6,000 characters).
 */
export async function fetchPage(rawUrl) {
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

  // DNS resolution to verify target IP is public
  try {
    const lookup = await dns.lookup(hostname, { all: true });
    for (const entry of lookup) {
      if (isPrivateIP(entry.address)) {
        throw new Error(`Restricted IP resolved (${entry.address}) - SSRF protection triggered`);
      }
    }
  } catch (err) {
    if (err.message.includes('SSRF protection')) throw err;
    throw new Error(`Failed to resolve host ${hostname}: ${err.message}`);
  }

  // Fetch with 6s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NudgeCopilot/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/') && !contentType.includes('application/xhtml+xml') && !contentType.includes('json')) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const html = await res.text();
    return cleanHtml(html);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out after 6 seconds');
    }
    throw err;
  }
}

/**
 * Cleans HTML content: strips scripts, styles, tags and truncates to 6,000 chars.
 */
export function cleanHtml(html) {
  if (!html) return '';

  let clean = html
    // Remove script and style tags and contents
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    // Remove comments
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Replace block tags with newline
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode basic HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Normalize whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

  // Truncate to 6,000 characters
  if (clean.length > 6000) {
    clean = clean.substring(0, 6000) + '... [truncated]';
  }

  return clean;
}
