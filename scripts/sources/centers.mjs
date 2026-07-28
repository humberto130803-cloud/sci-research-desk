// Rehab centers & programs.
//
// The list itself is hand-curated (data/centers.json) because there is no API that knows
// which programs actually take a 66-year-old chronic cervical patient. What the daily job
// does add: a liveness check on every link, and any news from the last 90 days that names
// the center — so an entry going quiet or a program shutting down becomes visible.

import { readFile } from 'node:fs/promises';
import { getText, clean, truncate, slugId, sleep, parseRSS } from '../lib/util.mjs';

// Hospital sites routinely serve 403/404 to anything that doesn't look like a browser, so a
// 4xx here means "we couldn't check", not "the page is gone". Only a failure to reach the
// host at all is treated as broken — otherwise this cries wolf every single morning.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function checkLink(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html,*/*' },
    });
    if (res.status < 400) return 'ok';
    if (res.status >= 500) return 'unreachable';
    return 'unverified';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(t);
  }
}

async function newsFor(name) {
  const q = `"${name.split('—')[0].trim()}" (spinal OR paralysis OR rehabilitation)`;
  const xml = await getText(
    `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:90d`)}&hl=en-US&gl=US&ceid=US:en`,
    { retries: 2 }
  );
  return parseRSS(xml)
    .slice(0, 3)
    .map((it) => ({
      title: clean(it.title),
      url: it.link,
      date: it.pubDate && !Number.isNaN(Date.parse(it.pubDate))
        ? new Date(it.pubDate).toISOString().slice(0, 10)
        : null,
    }));
}

export async function fetchCenters(rootDir) {
  const raw = JSON.parse(await readFile(new URL('../../data/centers.json', import.meta.url), 'utf8'));
  const out = [];

  for (const c of raw.centers) {
    const [linkStatus, mentions] = await Promise.all([checkLink(c.url), newsFor(c.name)]);
    out.push({
      ...c,
      kind: 'center',
      title: c.name,
      summary: c.known_for,
      linkStatus,
      recentNews: mentions,
      date: null,
    });
    if (linkStatus === 'unreachable') console.warn(`  ! unreachable: "${c.name}" ${c.url}`);
    await sleep(400);
  }

  const bad = out.filter((c) => c.linkStatus === 'unreachable').length;
  console.log(`  centers: ${out.length} programs, ${bad} unreachable`);
  return out;
}
