// Small shared helpers. No dependencies — Node 20+ built-ins only.

const UA = 'sci-research-desk/1.0 (personal research aggregator; contact via repo owner)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with retries and a polite user agent. Returns null instead of throwing. */
export async function getJSON(url, { retries = 3, timeout = 45000 } = {}) {
  return get(url, { retries, timeout, parse: 'json' });
}

export async function getText(url, { retries = 3, timeout = 45000 } = {}) {
  return get(url, { retries, timeout, parse: 'text' });
}

async function get(url, { retries, timeout, parse }) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'user-agent': UA, accept: parse === 'json' ? 'application/json' : '*/*' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parse === 'json' ? await res.json() : await res.text();
    } catch (err) {
      if (attempt === retries) {
        console.warn(`  ! failed after ${retries} tries: ${url}\n    ${err.message}`);
        return null;
      }
      await sleep(1200 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Collapse whitespace, strip HTML tags and decode the handful of entities that actually show up. */
export function clean(str = '') {
  return String(str)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Truncate on a word boundary. */
export function truncate(str = '', n = 320) {
  const s = clean(str);
  if (s.length <= n) return s;
  return s.slice(0, s.lastIndexOf(' ', n)) + '…';
}

/** Today as YYYY-MM-DD in UTC — stable regardless of where the job runs. */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(isoA, isoB) {
  const a = Date.parse(isoA), b = Date.parse(isoB);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Stable id for things that have no natural one (news items). */
export function slugId(prefix, ...parts) {
  const raw = parts.join('|').toLowerCase();
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return `${prefix}-${h.toString(36)}`;
}

/** Very small RSS <item> extractor. Good enough for Google News / journal feeds. */
export function parseRSS(xml) {
  if (!xml) return [];
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const body = block.slice(0, block.search(/<\/item>/i));
    const pick = (tag) => {
      const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      if (!m) return '';
      return clean(m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''));
    };
    const title = pick('title');
    const link = (body.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '').trim();
    if (!title || !link) continue;
    items.push({
      title,
      link: clean(link),
      pubDate: pick('pubDate') || pick('dc:date'),
      source: pick('source') || pick('dc:creator') || '',
      description: pick('description'),
    });
  }
  return items;
}
