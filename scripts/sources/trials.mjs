// ClinicalTrials.gov API v2 — open studies matching his profile.
// Docs: https://clinicaltrials.gov/data-api/api

import { getJSON, clean, truncate, sleep } from '../lib/util.mjs';
import { parseAge } from '../lib/score.mjs';

const BASE = 'https://clinicaltrials.gov/api/v2/studies';
const OPEN = ['RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION', 'AVAILABLE'];

const QUERIES = [
  { cond: 'spinal cord injury' },
  { cond: 'tetraplegia' },
  { cond: 'quadriplegia' },
  { cond: 'cervical spinal cord injury' },
  { cond: 'spinal cord injury', term: 'epidural stimulation' },
  { cond: 'spinal cord injury', term: 'brain computer interface' },
  { cond: 'spinal cord injury', term: 'nerve transfer' },
  { cond: 'spinal cord injury', term: 'stem cell' },
  { cond: 'spinal cord injury', term: 'upper limb function' },
  { cond: 'spinal cord injury', term: 'diaphragm pacing' },
];

function buildURL({ cond, term }, pageToken) {
  const p = new URLSearchParams();
  if (cond) p.set('query.cond', cond);
  if (term) p.set('query.term', term);
  p.set('filter.overallStatus', OPEN.join('|'));
  p.set('pageSize', '100');
  p.set('fields', 'protocolSection');
  p.set('countTotal', 'true');
  if (pageToken) p.set('pageToken', pageToken);
  return `${BASE}?${p.toString()}`;
}

function normalize(study) {
  const ps = study.protocolSection || {};
  const id = ps.identificationModule || {};
  const status = ps.statusModule || {};
  const desc = ps.descriptionModule || {};
  const elig = ps.eligibilityModule || {};
  const design = ps.designModule || {};
  const arms = ps.armsInterventionsModule || {};
  const contacts = ps.contactsLocationsModule || {};
  const sponsor = ps.sponsorCollaboratorsModule || {};

  const nctId = id.nctId;
  if (!nctId) return null;

  const locations = (contacts.locations || []).map((l) => ({
    facility: clean(l.facility || ''),
    city: clean(l.city || ''),
    state: clean(l.state || ''),
    country: clean(l.country || ''),
    status: l.status || '',
  }));

  const countries = [...new Set(locations.map((l) => l.country).filter(Boolean))];

  const contact =
    (contacts.centralContacts || []).find((c) => c.email || c.phone) ||
    (locations.length && (contacts.locations[0].contacts || []).find((c) => c.email || c.phone)) ||
    null;

  return {
    id: nctId,
    kind: 'trial',
    title: clean(id.briefTitle || id.officialTitle || nctId),
    officialTitle: clean(id.officialTitle || ''),
    url: `https://clinicaltrials.gov/study/${nctId}`,
    summary: truncate(desc.briefSummary || '', 900),
    fullSummary: clean(desc.briefSummary || ''),
    eligibilityText: clean(elig.eligibilityCriteria || ''),
    conditions: (ps.conditionsModule?.conditions || []).map(clean),
    interventions: (arms.interventions || []).map((i) => clean(`${i.type || ''}: ${i.name || ''}`)),
    sponsor: clean(sponsor.leadSponsor?.name || ''),
    status: status.overallStatus || '',
    phase: (design.phases || []).join(', '),
    studyType: design.studyType || '',
    enrollment: design.enrollmentInfo?.count ?? null,
    minAge: parseAge(elig.minimumAge),
    maxAge: parseAge(elig.maximumAge),
    stdAges: elig.stdAges || [],
    sex: elig.sex || 'ALL',
    date: status.lastUpdatePostDateStruct?.date || status.studyFirstPostDateStruct?.date || null,
    startDate: status.startDateStruct?.date || null,
    completionDate: status.completionDateStruct?.date || null,
    locations: locations.slice(0, 12),
    countries,
    contact: contact
      ? { name: clean(contact.name || ''), email: contact.email || '', phone: clean(contact.phone || '') }
      : null,
  };
}

export async function fetchTrials() {
  const byId = new Map();

  for (const q of QUERIES) {
    let pageToken = null;
    let pages = 0;
    do {
      const data = await getJSON(buildURL(q, pageToken));
      if (!data) break;
      for (const study of data.studies || []) {
        const n = normalize(study);
        if (n && !byId.has(n.id)) byId.set(n.id, n);
      }
      pageToken = data.nextPageToken || null;
      pages++;
      await sleep(300);
    } while (pageToken && pages < 4);
    console.log(`  trials: "${q.cond}${q.term ? ' / ' + q.term : ''}" → ${byId.size} unique so far`);
  }

  return [...byId.values()];
}
