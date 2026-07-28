// Relevance engine.
//
// Design rule: the ONLY hard exclusion is a structured age cap, because that is the one
// field ClinicalTrials.gov reports reliably. Everything else becomes a visible flag with a
// reason, so nothing promising gets silently buried by a regex.

import { clean } from './util.mjs';

const CERVICAL = /\b(c[1-8]\b|cervical|tetrapleg|quadripleg)/i;
const THORACIC_ONLY = /\b(parapleg|thoracic|lumbar)\b/i;
const ACUTE = /\b(acute|subacute)\b|within\s+(\d+)\s*(hours?|days?|weeks?)\s+(of|after|post|from)\b|(\d+)\s*(hours?|days?)\s+post[-\s]?injury/i;
const CHRONIC = /\bchronic\b|(at least|more than|greater than|>)\s*(\d+)\s*(months?|years?)\s+(post|after|since|from)/i;
const AIS_AB_ONLY = /\b(ais|asia|aisa)\s*[-:]?\s*(a\s*(or|,|\/|and)\s*b|a\b(?!\s*(-|to|through|–)\s*[cd]))/i;
const AIS_CD = /\b(ais|asia)\s*[-:]?\s*[abc]?\s*[-–to\/,]*\s*(c|d)\b/i;
const VENTILATOR_EXCL = /(ventilator|mechanical ventilation)[^.]{0,60}(exclu|not eligible|dependent are exclu)/i;

/** "65 Years" -> 65, "6 Months" -> 0.5, undefined -> null */
export function parseAge(str) {
  if (!str) return null;
  const m = String(str).match(/([\d.]+)\s*(year|month|week|day)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'year') return n;
  if (unit === 'month') return n / 12;
  if (unit === 'week') return n / 52;
  return n / 365;
}

function countTerms(haystack, terms) {
  let hits = 0;
  const matched = [];
  for (const t of terms) {
    if (haystack.includes(t.toLowerCase())) {
      hits++;
      matched.push(t);
    }
  }
  return { hits, matched };
}

/**
 * Score any item against the profile.
 * item: { title, summary, eligibilityText?, minAge?, maxAge?, stdAges?, date?, kind }
 * Returns { score, tags, flags, matchedPriorities, eligible }
 */
export function scoreItem(item, profile) {
  // Topic scoring reads only what the study is ABOUT. Eligibility text is full of boilerplate
  // ("uncontrolled blood pressure", "history of stroke") that otherwise fires every priority
  // term and flattens the ranking. Eligibility is still read below, for the gate checks.
  const topicText = clean(
    [item.title, item.summary, (item.conditions || []).join(' '), (item.interventions || []).join(' ')]
      .filter(Boolean)
      .join(' \n ')
  ).toLowerCase();

  const text = clean([topicText, item.eligibilityText || ''].join(' \n ')).toLowerCase();

  let score = 0;
  const tags = [];
  const flags = [];
  const matchedPriorities = [];
  let eligible = true;

  // --- Priority topics -------------------------------------------------
  for (const p of profile.priorities) {
    const { hits, matched } = countTerms(topicText, p.terms);
    if (hits > 0) {
      score += p.weight + Math.min(hits - 1, 3) * 2;
      matchedPriorities.push({ key: p.key, label: p.label, matched: matched.slice(0, 3) });
      tags.push(p.label);
    }
  }

  // --- Level match -----------------------------------------------------
  if (CERVICAL.test(text)) {
    score += 12;
    tags.push('Cervical / tetraplegia');
  } else if (THORACIC_ONLY.test(text) && !CERVICAL.test(text)) {
    score -= 14;
    flags.push({
      level: 'warn',
      text: 'Reads as paraplegia / thoracic-lumbar. May not include a C4-C5 injury.',
    });
  }

  // Explicit C4/C5 is the strongest possible signal.
  if (/\bc4\b|\bc5\b|\bc4\s*[-–/]\s*c5\b/i.test(text)) {
    score += 8;
    tags.push('C4–C5 named');
  }

  // --- ASIA grade ------------------------------------------------------
  if (AIS_CD.test(text)) {
    score += 8;
    tags.push(`AIS C/D in scope`);
  } else if (AIS_AB_ONLY.test(text)) {
    score -= 10;
    flags.push({
      level: 'warn',
      text: 'Appears to target AIS A/B (motor complete). He is documented AIS C — likely a mismatch, worth one email to confirm.',
    });
  }

  // --- Chronic vs acute ------------------------------------------------
  if (profile.chronic) {
    if (CHRONIC.test(text)) {
      score += 8;
      tags.push('Chronic injury');
    } else if (ACUTE.test(text)) {
      score -= 16;
      flags.push({
        level: 'warn',
        text: 'Enrolment window looks acute or subacute (measured from the date of injury). Chronic injuries are usually excluded.',
      });
    }
  }

  // --- Ventilator ------------------------------------------------------
  if (VENTILATOR_EXCL.test(item.eligibilityText || '')) {
    flags.push({ level: 'info', text: 'Excludes ventilator-dependent participants — check whether that applies.' });
  }

  // --- Watchlist organizations ----------------------------------------
  const { hits: orgHits, matched: orgMatched } = countTerms(topicText, profile.watchlist.organizations);
  if (orgHits > 0) {
    score += 6 + Math.min(orgHits - 1, 2) * 3;
    tags.push(`Watchlist: ${orgMatched[0]}`);
  }

  // --- Deprioritized topics -------------------------------------------
  const { hits: downHits, matched: downMatched } = countTerms(topicText, profile.deprioritize.terms);
  if (downHits > 0) {
    score -= 9 * downHits;
    if (downHits >= 1) {
      flags.push({ level: 'info', text: `Off-target topic: ${downMatched.slice(0, 2).join(', ')}.` });
    }
  }

  // --- AGE: the one hard gate -----------------------------------------
  const age = profile.age;
  const maxAge = item.maxAge ?? null;
  const minAge = item.minAge ?? null;

  if (maxAge !== null && age > maxAge) {
    eligible = false;
    flags.push({
      level: 'block',
      text: `Age cap is ${maxAge}. At ${age} he is over the limit — this is a hard exclusion unless the site grants an exception.`,
    });
  } else if (minAge !== null && age < minAge) {
    eligible = false;
    flags.push({ level: 'block', text: `Minimum age is ${minAge}.` });
  } else if (maxAge !== null) {
    score += 10;
    tags.push(`Age OK (cap ${maxAge})`);
  } else if (item.stdAges && item.stdAges.length) {
    if (item.stdAges.includes('OLDER_ADULT')) {
      score += 10;
      tags.push('Age OK (no upper limit)');
    } else {
      eligible = false;
      flags.push({
        level: 'block',
        text: 'Listed for adults under 65 only — no older-adult age band on the record.',
      });
    }
  }

  // --- Freshness -------------------------------------------------------
  if (item.date) {
    const ageDays = Math.round((Date.now() - Date.parse(item.date)) / 86400000);
    if (!Number.isNaN(ageDays)) {
      if (ageDays <= 14) score += 8;
      else if (ageDays <= 45) score += 4;
      else if (ageDays > 900) score -= 5;
    }
  }

  return {
    score: Math.round(score),
    tags: [...new Set(tags)],
    flags,
    matchedPriorities,
    eligible,
  };
}

/** Human-readable one-liner explaining the rank, shown on every card. */
export function explain(scored, item) {
  if (!scored.eligible) {
    const block = scored.flags.find((f) => f.level === 'block');
    return block ? block.text : 'Does not meet a listed eligibility requirement.';
  }
  const bits = [];
  if (scored.matchedPriorities.length) {
    bits.push(scored.matchedPriorities.slice(0, 2).map((p) => p.label.toLowerCase()).join(' and '));
  }
  if (scored.tags.includes('Cervical / tetraplegia')) bits.push('cervical-level');
  if (scored.tags.includes('Chronic injury')) bits.push('chronic');
  if (!bits.length) return 'Matched a general spinal cord injury search.';
  return `Surfaced for ${bits.join(', ')}.`;
}
