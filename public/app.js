/* SCI Research Desk — front end.
   No framework, no build step. Reads data/feed.json, which the daily job regenerates. */

(() => {
  'use strict';

  const STORE = 'sci-desk-state-v1';
  const PREFS = 'sci-desk-prefs-v1';

  const state = {
    feed: null,
    tab: 'today',
    query: '',
    newOnly: false,
    saved: new Set(),
    archived: new Set(),
    expanded: new Set(),
  };

  const prefs = { scale: 1, theme: null };

  /* ---------- storage ---------- */

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
      state.saved = new Set(raw.saved || []);
      state.archived = new Set(raw.archived || []);
    } catch { /* first visit */ }
    try {
      Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || '{}'));
    } catch { /* first visit */ }
  }

  function persist() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({ saved: [...state.saved], archived: [...state.archived] })
      );
    } catch { /* private mode — the site still works, it just forgets */ }
  }

  function persistPrefs() {
    try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch {}
  }

  /* ---------- helpers ---------- */

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : ''));
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function relativeDays(iso) {
    if (!iso) return '';
    const days = Math.round((Date.now() - Date.parse(iso)) / 86400000);
    if (Number.isNaN(days)) return '';
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    if (days < 365) return `${Math.round(days / 30)} months ago`;
    return `${Math.round(days / 365)} years ago`;
  }

  function placeLine(item) {
    if (!item.countries || !item.countries.length) return '';
    const list = item.countries.slice(0, 4).join(', ');
    const more = item.countries.length > 4 ? ` +${item.countries.length - 4} more` : '';
    return list + more;
  }

  /* ---------- tabs ---------- */

  const TABS = [
    { key: 'today', label: 'Today' },
    { key: 'trials', label: 'Open studies' },
    { key: 'blocked', label: 'Age-blocked' },
    { key: 'papers', label: 'Research' },
    { key: 'news', label: 'Technology' },
    { key: 'centers', label: 'Programs' },
    { key: 'saved', label: 'Saved' },
    { key: 'archive', label: 'Archive' },
  ];

  function itemsForTab(tab) {
    const s = state.feed.sections;
    const all = [...s.trials, ...s.blocked, ...s.papers, ...s.news, ...s.centers];
    switch (tab) {
      case 'today': {
        // The daily read has to stay readable in one sitting, so it is capped. Anything that
        // doesn't fit is still one tap away under its own tab — nothing is lost, just deferred.
        // Trials lead, because they are the only things he can actually act on.
        const byScore = (a, b) => b.score - a.score;
        const fresh = {
          trials: s.trials.filter((x) => x.isNew).sort(byScore).slice(0, 10),
          papers: s.papers.filter((x) => x.isNew).sort(byScore).slice(0, 6),
          news: s.news.filter((x) => x.isNew).sort(byScore).slice(0, 6),
        };
        const picked = [...fresh.trials, ...fresh.papers, ...fresh.news];
        if (picked.length >= 5) return picked;
        // Quiet day: top up with the strongest standing matches so the page is never bare.
        const seen = new Set(picked.map((x) => x.id));
        const filler = s.trials.filter((x) => !seen.has(x.id)).sort(byScore).slice(0, 8 - picked.length);
        return [...picked, ...filler];
      }
      case 'saved':
        return all.filter((x) => state.saved.has(x.id));
      case 'archive':
        return [...s.archive, ...all.filter((x) => state.archived.has(x.id))];
      default:
        return s[tab] || [];
    }
  }

  function visible(items, tab) {
    let out = items;
    if (tab !== 'archive' && tab !== 'saved') {
      out = out.filter((x) => !state.archived.has(x.id));
    }
    if (state.newOnly) out = out.filter((x) => x.isNew);
    if (state.query) {
      const q = state.query.toLowerCase();
      out = out.filter((x) =>
        `${x.title} ${x.summary || ''} ${(x.tags || []).join(' ')} ${(x.countries || []).join(' ')} ${x.sponsor || ''} ${x.journal || ''} ${x.outlet || ''} ${x.country || ''}`
          .toLowerCase()
          .includes(q)
      );
    }
    return out;
  }

  function renderTabs() {
    const el = $('#tabs');
    el.innerHTML = TABS.map((t) => {
      const items = visible(itemsForTab(t.key), t.key);
      const fresh = items.filter((x) => x.isNew).length;
      return `<button class="tab" role="tab" data-tab="${t.key}"
        aria-selected="${state.tab === t.key}">
        ${fresh && t.key !== 'today' ? '<span class="dot" aria-hidden="true"></span>' : ''}
        <span>${esc(t.label)}</span>
        <span class="count">${items.length}</span>
      </button>`;
    }).join('');
    el.setAttribute('role', 'tablist');
  }

  /* ---------- cards ---------- */

  function badges(item) {
    const out = [];
    if (item.isNew) out.push(`<span class="badge new">New</span>`);
    if (item.kind === 'trial') {
      out.push(`<span class="badge accent">${esc(item.status?.replace(/_/g, ' ').toLowerCase() || 'study')}</span>`);
      if (item.phase && item.phase !== 'NA') out.push(`<span class="badge">${esc(item.phase.replace(/PHASE/gi, 'Phase '))}</span>`);
    }
    if (item.kind === 'paper') out.push(`<span class="badge accent">Paper</span>`);
    if (item.kind === 'news') out.push(`<span class="badge accent">${esc(item.topic || 'News')}</span>`);
    if (item.kind === 'center') out.push(`<span class="badge accent">Program</span>`);
    if (item.eligible === false) out.push(`<span class="badge block">Not eligible</span>`);

    for (const tag of (item.tags || []).slice(0, 4)) {
      const good = /Age OK|Cervical|C4|Chronic|AIS C/.test(tag);
      out.push(`<span class="badge ${good ? 'good' : ''}">${esc(tag)}</span>`);
    }
    return out.join('');
  }

  function flagList(item) {
    if (!item.flags || !item.flags.length) return '';
    const mark = { block: '✕', warn: '!', info: 'i' };
    return `<ul class="flags">${item.flags
      .map(
        (f) =>
          `<li class="flag ${esc(f.level)}"><span class="mark" aria-hidden="true">${mark[f.level] || 'i'}</span><span>${esc(f.text)}</span></li>`
      )
      .join('')}</ul>`;
  }

  function metaFor(item) {
    const rows = [];
    if (item.kind === 'trial') {
      if (item.sponsor) rows.push(`<strong>Run by</strong> ${esc(item.sponsor)}`);
      const where = placeLine(item);
      if (where) rows.push(`<strong>Where</strong> ${esc(where)}`);
      if (item.enrollment) rows.push(`<strong>Enrolling</strong> ${item.enrollment} participants`);
      const ages = [];
      if (item.minAge != null) ages.push(`from ${Math.round(item.minAge)}`);
      ages.push(item.maxAge != null ? `up to ${Math.round(item.maxAge)}` : 'no upper limit');
      rows.push(`<strong>Ages</strong> ${esc(ages.join(', '))}`);
      if (item.date) rows.push(`<strong>Updated</strong> ${esc(fmtDate(item.date))} (${relativeDays(item.date)})`);
      if (item.completionDate) rows.push(`<strong>Expected to finish</strong> ${esc(fmtDate(item.completionDate))}`);
    }
    if (item.kind === 'paper') {
      if (item.journal) rows.push(`<strong>${esc(item.journal)}</strong>`);
      if (item.authorLine) rows.push(esc(item.authorLine));
      if (item.date) rows.push(`Published ${esc(fmtDate(item.date))}`);
    }
    if (item.kind === 'news') {
      const bits = [item.outlet, item.date ? relativeDays(item.date) : ''].filter(Boolean);
      if (bits.length) rows.push(esc(bits.join(' · ')));
    }
    if (item.kind === 'center') {
      rows.push(`<strong>Where</strong> ${esc([item.city, item.country].filter(Boolean).join(', '))}`);
    }
    if (!rows.length) return '';
    return `<div class="meta meta-grid">${rows.map((r) => `<div>${r}</div>`).join('')}</div>`;
  }

  function contactFor(item) {
    if (item.kind !== 'trial' || !item.contact) return '';
    const c = item.contact;
    const bits = [];
    if (c.name) bits.push(esc(c.name));
    if (c.email) bits.push(`<a href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Enquiry about ' + item.id)}">${esc(c.email)}</a>`);
    if (c.phone) bits.push(`<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>`);
    if (!bits.length) return '';
    return `<div class="contact"><strong>Study contact:</strong> ${bits.join(' · ')}</div>`;
  }

  function centerExtras(item) {
    let out = '';
    if (item.why_relevant) out += `<p class="summary"><strong>Why it's on the list.</strong> ${esc(item.why_relevant)}</p>`;
    if (item.confirmDirectly?.length) {
      out += `<div class="meta"><strong>Confirm by phone or email:</strong><ul class="confirm-list">${item.confirmDirectly
        .map((c) => `<li>${esc(c)}</li>`)
        .join('')}</ul></div>`;
    }
    if (item.linkStatus === 'unreachable') {
      out += `<ul class="flags"><li class="flag warn"><span class="mark" aria-hidden="true">!</span><span>Their website did not respond when this page was built. Worth checking the program still exists.</span></li></ul>`;
    }
    if (item.recentNews?.length) {
      out += `<div class="meta"><strong>Recent mentions</strong><ul class="center-news">${item.recentNews
        .map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`)
        .join('')}</ul></div>`;
    }
    return out;
  }

  function cardHTML(item) {
    const isSaved = state.saved.has(item.id);
    const isArchived = state.archived.has(item.id);
    const expanded = state.expanded.has(item.id);
    const summary = item.summary || '';
    const longSummary = summary.length > 340;

    return `<article class="card ${item.isNew ? 'is-new' : ''} ${item.eligible === false ? 'is-blocked' : ''}" data-id="${esc(item.id)}">
      <div class="badges">${badges(item)}</div>
      <h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
      ${item.why ? `<p class="why">${esc(item.why)}</p>` : ''}
      ${summary ? `<p class="summary ${longSummary && !expanded ? 'clamped' : ''}">${esc(summary)}</p>` : ''}
      ${longSummary ? `<button class="expand" data-act="expand">${expanded ? 'Show less' : 'Show more'}</button>` : ''}
      ${item.kind === 'center' ? centerExtras(item) : ''}
      ${flagList(item)}
      ${metaFor(item)}
      ${contactFor(item)}
      ${item.exploredNote ? `<div class="contact"><strong>Note:</strong> ${esc(item.exploredNote)}</div>` : ''}
      <div class="actions">
        <a class="btn primary" href="${esc(item.url)}" target="_blank" rel="noopener">Open</a>
        <button class="btn" data-act="save" aria-pressed="${isSaved}">${isSaved ? 'Saved' : 'Save'}</button>
        <button class="btn" data-act="archive">${isArchived ? 'Bring back' : 'Done with this'}</button>
      </div>
    </article>`;
  }

  /* ---------- briefing ---------- */

  function renderBriefing() {
    const b = state.feed.briefing;
    const el = $('#briefing');
    const body = $('#briefing-body');
    const parts = [];

    parts.push(`<p class="lede">${esc(b.lines[0] || '')}</p>`);
    if (b.lines.length > 1) parts.push(`<p>${esc(b.lines.slice(1).join(' '))}</p>`);

    if (b.headline) {
      parts.push(`<div class="top-pick">
        <div class="label">Top match right now</div>
        <a href="https://clinicaltrials.gov/study/${esc(b.headline.id)}" target="_blank" rel="noopener">${esc(b.headline.title)}</a>
        <div class="meta">${esc(b.headline.why)}</div>
      </div>`);
    }

    if (b.closingSoon?.length) {
      parts.push(
        `<p class="closing">Finishing within the year: ${b.closingSoon
          .map((c) => esc(c.title))
          .join('; ')}. Worth contacting sooner rather than later.</p>`
      );
    }

    body.innerHTML = parts.join('');
    el.hidden = false;
  }

  /* ---------- render ---------- */

  function render() {
    renderTabs();

    const items = visible(itemsForTab(state.tab), state.tab);
    const cards = $('#cards');
    cards.innerHTML = items.map(cardHTML).join('');

    $('#empty').hidden = items.length > 0;
    $('#empty').textContent =
      state.query || state.newOnly
        ? 'Nothing matches those filters.'
        : state.tab === 'saved'
          ? 'Nothing saved yet. Tap Save on anything worth coming back to.'
          : 'Nothing here today.';

    const fresh = items.filter((x) => x.isNew).length;
    let count = items.length
      ? `${items.length} item${items.length === 1 ? '' : 's'}${fresh ? `, ${fresh} new` : ''}`
      : '';

    // Be explicit when Today is showing a shortlist rather than everything.
    if (state.tab === 'today' && !state.query && !state.newOnly) {
      const s = state.feed.sections;
      const totalNew = [...s.trials, ...s.papers, ...s.news].filter((x) => x.isNew).length;
      if (totalNew > items.length) {
        count = `Showing the top ${items.length} of ${totalNew} new items — the rest are under their own tabs.`;
      }
    }
    $('#result-count').textContent = count;

    $('#briefing').hidden = state.tab !== 'today';
  }

  /* ---------- events ---------- */

  function wire() {
    $('#tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      state.tab = btn.dataset.tab;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    $('#cards').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('.card').dataset.id;
      const act = btn.dataset.act;

      if (act === 'save') {
        state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
        persist();
      } else if (act === 'archive') {
        state.archived.has(id) ? state.archived.delete(id) : state.archived.add(id);
        persist();
      } else if (act === 'expand') {
        state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      }
      render();
    });

    let searchTimer;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const v = e.target.value.trim();
      searchTimer = setTimeout(() => {
        state.query = v;
        render();
      }, 180);
    });

    $('#new-only').addEventListener('click', (e) => {
      state.newOnly = !state.newOnly;
      e.currentTarget.setAttribute('aria-pressed', String(state.newOnly));
      render();
    });

    $('#text-bigger').addEventListener('click', () => setScale(prefs.scale + 0.1));
    $('#text-smaller').addEventListener('click', () => setScale(prefs.scale - 0.1));

    $('#theme-toggle').addEventListener('click', () => {
      const current =
        prefs.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      prefs.theme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = prefs.theme;
      persistPrefs();
    });

    $('#export-state').addEventListener('click', exportState);
  }

  function setScale(v) {
    prefs.scale = Math.min(1.6, Math.max(0.85, Math.round(v * 100) / 100));
    document.documentElement.style.setProperty('--scale', prefs.scale);
    persistPrefs();
  }

  function exportState() {
    const all = [
      ...state.feed.sections.trials,
      ...state.feed.sections.blocked,
      ...state.feed.sections.papers,
      ...state.feed.sections.news,
      ...state.feed.sections.centers,
    ];
    const pick = (set) =>
      all.filter((x) => set.has(x.id)).map((x) => `- ${x.title}\n  ${x.url}`).join('\n');

    const text =
      `Saved (${state.saved.size})\n${pick(state.saved) || '- none'}\n\n` +
      `Done with (${state.archived.size})\n${pick(state.archived) || '- none'}\n`;

    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `research-desk-${state.feed.date}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- boot ---------- */

  async function boot() {
    loadState();
    if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.style.setProperty('--scale', prefs.scale || 1);

    try {
      // A standalone snapshot (scripts/preview.mjs) inlines the feed instead, so the whole
      // site can be opened from a single file with no server.
      if (window.__FEED__) {
        state.feed = window.__FEED__;
      } else {
        const res = await fetch(`data/feed.json?v=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.feed = await res.json();
      }
    } catch (err) {
      $('#subtitle').textContent = 'Could not load today’s research.';
      $('#cards').innerHTML =
        `<article class="card"><h3>Nothing loaded</h3><p class="summary">The daily file could not be read (${esc(err.message)}). It usually rebuilds itself each morning — try again in a little while.</p></article>`;
      return;
    }

    const p = state.feed.profile;
    document.title = p.siteTitle || 'Research Desk';
    $('#site-title').textContent = p.siteTitle || 'Research Desk';
    $('#subtitle').textContent =
      `${p.injuryLevel} · ASIA ${p.asiaGrade} · age ${p.age} · ${p.country} — updated ${fmtDate(state.feed.date)}`;
    $('#foot-updated').textContent = `Last rebuilt ${new Date(state.feed.generatedAt).toLocaleString()}.`;

    renderBriefing();
    wire();
    render();
  }

  boot();
})();
