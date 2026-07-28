// PubMed via NCBI E-utilities. No API key required (we stay well under the rate limit).

import { getJSON, getText, clean, truncate, sleep } from '../lib/util.mjs';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// Each query is deliberately narrow. A broad "spinal cord injury" search returns
// mostly epidemiology and survey papers, which are noise for him.
const QUERIES = [
  '(cervical spinal cord injury) AND (recovery OR restoration OR regeneration)',
  '(tetraplegia OR quadriplegia) AND (upper limb OR hand function OR grasp)',
  '(spinal cord injury) AND (epidural stimulation OR transcutaneous spinal stimulation)',
  '(spinal cord injury) AND (brain-computer interface OR neuroprosthesis)',
  '(spinal cord injury) AND (nerve transfer OR tendon transfer)',
  '(spinal cord injury) AND (stem cell OR cell transplantation) AND (clinical trial OR human)',
  '(chronic spinal cord injury) AND (clinical trial)',
  '(spinal cord injury) AND (diaphragm pacing OR phrenic nerve OR respiratory recovery)',
];

const RELDAYS = 60; // rolling window; anything older is not "news"

export async function fetchPubMed() {
  const ids = new Set();

  for (const q of QUERIES) {
    const url =
      `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=40&sort=pub_date` +
      `&datetype=edat&reldate=${RELDAYS}&term=${encodeURIComponent(q)}`;
    const data = await getJSON(url);
    for (const id of data?.esearchresult?.idlist || []) ids.add(id);
    await sleep(400);
  }

  if (!ids.size) return [];

  const all = [...ids];
  const out = [];

  // esummary in batches of 100, then efetch abstracts for the same batch.
  for (let i = 0; i < all.length; i += 100) {
    const batch = all.slice(i, i + 100);
    const sum = await getJSON(
      `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${batch.join(',')}`
    );
    await sleep(400);
    const abstracts = await fetchAbstracts(batch);
    await sleep(400);

    for (const pmid of batch) {
      const r = sum?.result?.[pmid];
      if (!r || r.error) continue;
      const authors = (r.authors || []).map((a) => a.name).filter(Boolean);
      out.push({
        id: `PMID${pmid}`,
        kind: 'paper',
        title: clean(r.title || ''),
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        doi: (r.articleids || []).find((a) => a.idtype === 'doi')?.value || '',
        journal: clean(r.fulljournalname || r.source || ''),
        authors: authors.slice(0, 4),
        authorLine:
          authors.length > 4 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', '),
        pubType: (r.pubtype || []).join(', '),
        date: normalizeDate(r.sortpubdate || r.pubdate),
        summary: truncate(abstracts[pmid] || '', 900),
        fullSummary: abstracts[pmid] || '',
      });
    }
  }

  console.log(`  pubmed: ${out.length} papers in the last ${RELDAYS} days`);
  return out;
}

function normalizeDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(/\//g, '-').split(' ')[0]);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchAbstracts(pmids) {
  const xml = await getText(
    `${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&id=${pmids.join(',')}`
  );
  const map = {};
  if (!xml) return map;
  const articles = xml.split(/<PubmedArticle>/).slice(1);
  for (const art of articles) {
    const pmid = art.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    if (!pmid) continue;
    const texts = [...art.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) =>
      clean(m[1])
    );
    if (texts.length) map[pmid] = texts.join(' ');
  }
  return map;
}
