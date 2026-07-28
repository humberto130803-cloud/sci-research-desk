#!/usr/bin/env node
// Daily research job. Fetch → score → diff against what we've already seen → write feed.json.
//
// Run:  node scripts/build.mjs
// Output: public/data/feed.json  (+ data/seen.json is updated in place and committed)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { fetchTrials } from './sources/trials.mjs';
import { fetchPubMed } from './sources/pubmed.mjs';
import { fetchNews } from './sources/news.mjs';
import { fetchCenters } from './sources/centers.mjs';
import { scoreItem, explain } from './lib/score.mjs';
import { today, clean } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => path.join(ROOT, ...s);

const LIMITS = { trials: 90, blocked: 45, papers: 60, news: 45 };

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function isExplored(item, explored) {
  if (item.kind === 'trial' && explored.nctIds.includes(item.id)) return true;
  if (item.kind === 'paper' && explored.pmids.includes(item.id.replace(/^PMID/, ''))) return true;
  const hay = `${item.title} ${item.summary || ''}`.toLowerCase();
  return explored.keywords.some((k) => k && hay.includes(String(k).toLowerCase()));
}

async function main() {
  const runDate = today();
  console.log(`\nSCI Research Desk — daily run ${runDate}\n`);

  const profile = await readJSON(p('profile.json'));
  const explored = await readJSON(p('data', 'explored.json'), { nctIds: [], pmids: [], keywords: [], notes: {} });
  const seen = await readJSON(p('data', 'seen.json'), {});
  const isFirstRun = Object.keys(seen).length === 0;

  console.log('Fetching sources…');
  const [trials, papers, news, centers] = await Promise.all([
    fetchTrials().catch((e) => (console.warn('  ! trials failed:', e.message), [])),
    fetchPubMed().catch((e) => (console.warn('  ! pubmed failed:', e.message), [])),
    fetchNews().catch((e) => (console.warn('  ! news failed:', e.message), [])),
    fetchCenters().catch((e) => (console.warn('  ! centers failed:', e.message), [])),
  ]);

  // --- score + annotate ------------------------------------------------
  // Scoring reads the full text; the shipped feed carries a trimmed copy, because this file
  // is downloaded on a tablet over mobile data every morning.
  const slim = ({ fullSummary, eligibilityText, ...rest }) => ({
    ...rest,
    eligibilityText: eligibilityText ? eligibilityText.slice(0, 2000) : undefined,
  });

  const enrich = (items) =>
    items.map((it) => {
      const s = scoreItem(it, profile);
      const firstSeen = seen[it.id] || runDate;
      seen[it.id] = firstSeen;
      return {
        ...slim(it),
        ...s,
        why: explain(s, it),
        firstSeen,
        isNew: firstSeen === runDate,
        explored: isExplored(it, explored),
        exploredNote: explored.notes?.[it.id] || null,
      };
    });

  const allTrials = enrich(trials).sort((a, b) => b.score - a.score);
  const allPapers = enrich(papers).sort((a, b) => b.score - a.score);
  const allNews = enrich(news).sort((a, b) => b.score - a.score);

  const openTrials = allTrials.filter((t) => t.eligible && !t.explored).slice(0, LIMITS.trials);
  const blockedTrials = allTrials.filter((t) => !t.eligible && !t.explored).slice(0, LIMITS.blocked);
  const archived = [...allTrials, ...allPapers, ...allNews].filter((x) => x.explored);

  const topPapers = allPapers.filter((x) => !x.explored && x.score > 0).slice(0, LIMITS.papers);
  const topNews = allNews.filter((x) => !x.explored && x.score > -5).slice(0, LIMITS.news);

  const scoredCenters = centers.map((c) => ({ ...c, score: 0, isNew: false, explored: false }));

  // --- briefing --------------------------------------------------------
  const newOpen = openTrials.filter((t) => t.isNew);
  const newPapers = topPapers.filter((x) => x.isNew);
  const newNews = topNews.filter((x) => x.isNew);
  const lines = [];
  if (isFirstRun) {
    lines.push(
      `First run — everything below is new. ${openTrials.length} open studies clear the age filter, ${blockedTrials.length} are blocked by an age cap, plus ${topPapers.length} recent papers and ${topNews.length} technology items.`
    );
  } else {
    lines.push(
      newOpen.length
        ? `${newOpen.length} new open ${newOpen.length === 1 ? 'study' : 'studies'} since yesterday.`
        : 'No new open studies since yesterday.'
    );
    if (newPapers.length) lines.push(`${newPapers.length} new ${newPapers.length === 1 ? 'paper' : 'papers'}.`);
    if (newNews.length) lines.push(`${newNews.length} new technology ${newNews.length === 1 ? 'item' : 'items'}.`);
  }

  const headline = openTrials[0]
    ? { title: openTrials[0].title, id: openTrials[0].id, why: openTrials[0].why, score: openTrials[0].score }
    : null;

  const regulatory = topNews.filter((n) => n.topic === 'Regulatory' && n.isNew);
  if (regulatory.length && !isFirstRun) {
    lines.push(
      `${regulatory.length} regulatory ${regulatory.length === 1 ? 'item' : 'items'} (approvals or clearances) worth a look.`
    );
  }

  const closingSoon = openTrials
    .filter((t) => t.completionDate && Date.parse(t.completionDate) - Date.now() < 200 * 86400000)
    .slice(0, 3);

  const feed = {
    generatedAt: new Date().toISOString(),
    date: runDate,
    profile: {
      displayName: profile.displayName,
      siteTitle: profile.siteTitle,
      age: profile.age,
      injuryLevel: profile.injuryLevel,
      asiaGrade: profile.asiaGrade,
      asiaAlsoConsidered: profile.asiaAlsoConsidered,
      country: profile.country,
    },
    briefing: {
      headline,
      lines,
      closingSoon: closingSoon.map((t) => ({ id: t.id, title: t.title, completionDate: t.completionDate })),
      counts: {
        openTrials: openTrials.length,
        newOpenTrials: newOpen.length,
        ageBlocked: blockedTrials.length,
        papers: topPapers.length,
        newPapers: newPapers.length,
        news: topNews.length,
        newNews: newNews.length,
        centers: scoredCenters.length,
        archived: archived.length,
      },
    },
    sections: {
      trials: openTrials,
      blocked: blockedTrials,
      papers: topPapers,
      news: topNews,
      centers: scoredCenters,
      archive: archived.slice(0, 200),
    },
    exploredNotes: explored.notes || {},
  };

  await mkdir(p('public', 'data'), { recursive: true });
  await writeFile(p('public', 'data', 'feed.json'), JSON.stringify(feed, null, 1));
  await writeFile(p('data', 'seen.json'), JSON.stringify(seen, null, 0));

  console.log(
    `\nDone. ${openTrials.length} open trials (${newOpen.length} new), ${blockedTrials.length} age-blocked, ` +
      `${topPapers.length} papers, ${topNews.length} news, ${scoredCenters.length} centers.`
  );
  console.log(`Wrote public/data/feed.json (${(JSON.stringify(feed).length / 1024).toFixed(0)} KB)\n`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
