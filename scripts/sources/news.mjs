// Device / technology / company news, via Google News RSS. Keyless, no rate limits worth
// worrying about at this volume.
//
// openFDA was tried here and dropped: its device endpoints are dominated by pain-management
// spinal cord stimulators and ophthalmic neurostimulators, and the newest SCI-relevant
// records were years stale. The "Regulatory" queries below catch clearances that matter
// (ARC-EX and the like) with far better signal.

import { getText, clean, truncate, slugId, sleep, parseRSS } from '../lib/util.mjs';

const GNEWS = (q, days = 21) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${days}d`)}&hl=en-US&gl=US&ceid=US:en`;

const TOPIC_QUERIES = [
  '"spinal cord injury" (breakthrough OR trial OR approval OR implant)',
  '"spinal cord stimulation" paralysis',
  '"epidural stimulation" spinal cord injury',
  'tetraplegia OR quadriplegia technology',
  '"brain-computer interface" paralysis',
  'exoskeleton paralysis FDA',
  '"nerve transfer" tetraplegia hand',
  '"diaphragm pacing" OR "phrenic nerve" ventilator',
  '"functional electrical stimulation" spinal cord',
  'spinal cord injury "stem cell" trial results',
];

// Companies worth a name-level watch. Kept short on purpose — one query each.
const COMPANY_QUERIES = [
  'Onward Medical ARC-EX',
  'Neuralink participant',
  'Synchron BCI',
  'NervGen NVG-291',
  'Blackrock Neurotech',
  'Precision Neuroscience',
  'Lineage Cell OPC1 spinal',
  'NeuroRestore Courtine spinal',
  'Ekso Bionics OR ReWalk OR Wandercraft',
];

const REGULATORY_QUERIES = [
  'FDA clearance OR approval spinal cord injury device',
  'FDA "breakthrough device" paralysis OR tetraplegia',
  '"CE mark" OR "FDA approval" neurostimulation paralysis',
  'Health Canada OR EMA approval spinal cord injury therapy',
];

function rssItemToNews(it, topic) {
  // Google News puts the outlet after a trailing " - Outlet" in the title.
  const m = it.title.match(/^(.*)\s+-\s+([^-]+)$/);
  const title = clean(m ? m[1] : it.title);
  const outlet = clean(it.source || (m ? m[2] : ''));
  const date = it.pubDate ? new Date(it.pubDate) : null;
  return {
    id: slugId('news', title),
    kind: 'news',
    title,
    url: it.link,
    outlet,
    topic,
    summary: truncate(it.description || '', 400),
    date: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null,
  };
}

async function fetchGoogleNews() {
  const byId = new Map();
  const queries = [
    ...TOPIC_QUERIES.map((q) => ({ q, topic: 'Technology' })),
    ...COMPANY_QUERIES.map((q) => ({ q, topic: 'Company watch', days: 45 })),
    ...REGULATORY_QUERIES.map((q) => ({ q, topic: 'Regulatory', days: 90 })),
  ];

  for (const { q, topic, days } of queries) {
    const xml = await getText(GNEWS(q, days ?? 21));
    for (const it of parseRSS(xml)) {
      const n = rssItemToNews(it, topic);
      if (n.title.length < 15) continue;
      if (!byId.has(n.id)) byId.set(n.id, n);
    }
    await sleep(500);
  }
  return [...byId.values()];
}

export async function fetchNews() {
  const news = await fetchGoogleNews();
  const reg = news.filter((n) => n.topic === 'Regulatory').length;
  console.log(`  news: ${news.length} articles (${reg} regulatory)`);
  return news;
}
