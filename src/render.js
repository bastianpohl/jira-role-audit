/**
 * @param {import('./invert.js').AuditData} data
 * @returns {string}
 */
function embedJson(data) {
  // Escape "<" so "</script>" inside strings cannot close the tag.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * Render the audit data into a single self-contained HTML document.
 * @param {import('./invert.js').AuditData} data
 * @returns {string}
 */
export function renderHtml(data) {
  const json = embedJson(data);
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jira Rollen-/Bereichs-Report</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 1.5rem; }
  h1 { font-size: 1.3rem; }
  .meta { color: #888; font-size: .85rem; margin-bottom: 1rem; }
  input[type=search] { padding: .4rem .6rem; flex: 1 1 220px; max-width: 320px; }
  input[type=number] { padding: .4rem .5rem; width: 5.5rem; }
  .controls { display: flex; flex-wrap: wrap; gap: .6rem 1rem; align-items: flex-end; margin-bottom: 1rem; }
  .controls label { font-size: .9rem; }
  /* Each label stays glued to its control, so wrapping never splits the pair. */
  .field { display: inline-flex; align-items: center; gap: .35rem; }
  .controls button { padding: .4rem .7rem; cursor: pointer; }
  .controls select { padding: .35rem .4rem; max-width: 220px; }
  .facet-btn .badge {
    display: inline-block; margin-left: .4rem; padding: 0 .4rem; border-radius: 999px;
    background: #0288d1; color: #fff; font-size: .8rem; font-variant-numeric: tabular-nums;
  }
  .facet-btn.active { border-color: #0288d1; }
  dialog { border: 1px solid #8886; border-radius: 6px; padding: 1rem; min-width: 280px; max-width: 90vw; }
  dialog::backdrop { background: #0008; }
  dialog h2 { font-size: 1.05rem; margin: 0 0 .6rem; }
  .facet-bulk { display: flex; gap: .5rem; align-items: center; margin-bottom: .5rem; }
  .facet-bulk button { padding: .2rem .5rem; cursor: pointer; font-size: .85rem; }
  .facet-list { max-height: 50vh; overflow-y: auto; border: 1px solid #8884; border-radius: 4px; padding: .4rem .6rem; }
  .facet-list label { display: flex; align-items: center; gap: .5rem; padding: .2rem 0; cursor: pointer; }
  .facet-list .empty { color: #888; font-style: italic; }
  .facet-actions { display: flex; justify-content: flex-end; gap: .5rem; margin-top: .8rem; }
  .facet-actions button { padding: .4rem .9rem; cursor: pointer; }
  .facet-actions .primary { font-weight: 600; }
  .status-inactive { color: #c62828; font-weight: 600; }
  .status-unknown { color: #888; font-style: italic; }
  .groups { margin-top: .3rem; }
  #count { margin-top: .75rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid #8884; }
  th { cursor: pointer; user-select: none; }
  tbody tr.clickable:hover { background: #8882; cursor: pointer; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .via-group { color: #b26a00; }
  .back { display: inline-block; margin-bottom: 1rem; cursor: pointer; color: #06c; }
  .hidden { display: none; }
  code { background: #8882; padding: 0 .3rem; border-radius: 3px; }
  .banner { border-left: 4px solid; padding: .7rem 1rem; margin-bottom: 1rem; border-radius: 3px; }
  .banner h2 { font-size: 1rem; margin: 0 0 .4rem; }
  .banner ul { margin: .4rem 0 0; padding-left: 1.2rem; }
  .banner li { margin: .15rem 0; }
  .banner .reason { color: #888; }
  .banner-gap { border-color: #c62828; background: #c6282814; }
  .banner-scope { border-color: #0288d1; background: #0288d114; }
  .banner-excluded { border-color: #6a1b9a; background: #6a1b9a14; }
  .banner .alert { color: #c62828; font-weight: 600; }
</style>
</head>
<body>
<h1>Jira Rollen-/Bereichs-Report</h1>
<div class="meta" id="meta"></div>
<div id="gap-banner" class="banner banner-gap hidden"></div>
<div id="excluded-banner" class="banner banner-excluded hidden"></div>
<div id="scope-banner" class="banner banner-scope"></div>

<section id="overview">
  <div class="controls">
    <input type="search" id="filter" placeholder="Nach Name oder E-Mail filtern…">
    <span class="field">
      <label for="min-areas">Bereiche von</label>
      <input type="number" id="min-areas" min="0" step="1" inputmode="numeric" placeholder="min">
      <label for="max-areas">bis</label>
      <input type="number" id="max-areas" min="0" step="1" inputmode="numeric" placeholder="max">
    </span>
    <span class="field">
      <label for="status-filter">Status</label>
      <select id="status-filter">
        <option value="">alle</option>
        <option value="active">nur aktive</option>
        <option value="inactive">nur inaktive</option>
        <option value="unknown">Status unbekannt</option>
      </select>
    </span>
    <button type="button" class="facet-btn" id="group-btn" data-facet="group">Gruppen</button>
    <button type="button" class="facet-btn" id="role-btn" data-facet="role">Rollen</button>
    <button type="button" id="reset">Filter zurücksetzen</button>
  </div>
  <table>
    <thead><tr>
      <th data-sort="displayName">Name</th>
      <th data-sort="emailAddress">E-Mail</th>
      <th data-sort="statusLabel">Status</th>
      <th data-sort="areaCount" class="num">Anzahl Bereiche</th>
    </tr></thead>
    <tbody id="overview-body"></tbody>
  </table>
  <div class="meta" id="count"></div>
</section>

<dialog id="facet-dialog">
  <h2 id="facet-title"></h2>
  <div class="facet-bulk">
    <button type="button" id="facet-all">Alle</button>
    <button type="button" id="facet-none">Keine</button>
    <span id="facet-selected" class="meta"></span>
  </div>
  <div id="facet-list" class="facet-list"></div>
  <div class="facet-actions">
    <button type="button" id="facet-cancel">Abbrechen</button>
    <button type="button" id="facet-apply" class="primary">Übernehmen</button>
  </div>
</dialog>

<section id="detail" class="hidden">
  <span class="back" id="back">&larr; Zurück zur Übersicht</span>
  <h2 id="detail-name"></h2>
  <div class="meta" id="detail-sub"></div>
  <table>
    <thead><tr><th>Projekt</th><th>Key</th><th>Rolle</th><th>Zugriffsweg</th></tr></thead>
    <tbody id="detail-body"></tbody>
  </table>
</section>

<script id="audit-data" type="application/json">${json}</script>
<script>
(function () {
  const data = JSON.parse(document.getElementById('audit-data').textContent);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  document.getElementById('meta').textContent =
    'Erzeugt: ' + data.generatedAt + ' · ' + data.baseUrl + ' · ' + data.users.length + ' Benutzer';

  let sortKey = 'displayName';
  let sortDir = 1;
  let filter = '';
  let minAreas = null;
  let maxAreas = null;
  // Multi-select facets: OR within a facet, AND between facets. An empty
  // selection means "no restriction" rather than "match nothing".
  let groupFilter = [];
  let roleFilter = [];
  let statusFilter = '';

  function matchesAny(selected, values) {
    return selected.length === 0 || values.some((v) => selected.includes(v));
  }

  // An unknown status is shown as such, never silently folded into "Aktiv" —
  // a permissions report should not invent a fact it failed to fetch.
  function statusLabel(u) {
    if (u.active === true) return 'Aktiv';
    if (u.active === false) return 'Inaktiv';
    return 'unbekannt';
  }

  function statusKey(u) {
    if (u.active === true) return 'active';
    if (u.active === false) return 'inactive';
    return 'unknown';
  }

  function userGroups(u) {
    return u.groups || [];
  }

  function userRoles(u) {
    return u.roles || [];
  }

  // Empty and non-numeric both mean "no bound" — a half-typed value must not
  // silently hide rows.
  function readBound(id) {
    const raw = document.getElementById(id).value.trim();
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function gapList(title, gaps) {
    if (gaps.length === 0) return '';
    return '<div><strong>' + title + '</strong><ul>' + gaps
      .map((g) =>
        '<li><code>' + esc(g.key) + '</code> ' + esc(g.name) +
        ' <span class="reason">— ' + esc(g.reasons.join('; ')) + '</span></li>')
      .join('') + '</ul></div>';
  }

  // Deliberate exclusions get their own banner rather than being folded into the
  // gap list: they are a choice, not a failure — but leaving them unstated would
  // make the report quietly narrower than it looks.
  function renderExcludedBanner(cov) {
    const excluded = (cov && cov.excludedProjects) || [];
    const unmatched = (cov && cov.unmatchedExclusions) || [];
    if (excluded.length === 0 && unmatched.length === 0) return;

    const banner = document.getElementById('excluded-banner');
    const listed = excluded.length > 0
      ? '<ul>' + excluded
          .map((p) => '<li><code>' + esc(p.key) + '</code> ' + esc(p.name) + '</li>')
          .join('') + '</ul>'
      : '';
    const warn = unmatched.length > 0
      ? '<p class="alert">Ohne Wirkung: ' + esc(unmatched.join(', ')) +
        ' — kein sichtbares Projekt hat diese Schlüssel. Tippfehler oder fehlende ' +
        'Berechtigung; diese Projekte sind also nicht nachweislich ausgeschlossen.</p>'
      : '';

    banner.innerHTML =
      '<h2>Bewusst ausgeschlossen (' + excluded.length + ')</h2>' +
      (excluded.length > 0
        ? 'Diese Projekte wurden per Konfiguration übergangen und sind in den Zahlen unten nicht enthalten.'
        : '') +
      listed + warn;
    banner.classList.remove('hidden');
  }

  // The report's completeness depends entirely on the acting account's permissions,
  // so state the scope unconditionally and call out measurable gaps loudly.
  function renderBanners() {
    const cov = data.coverage;
    const who = data.identity ? esc(data.identity) : 'dem verwendeten Konto';
    const counts = cov
      ? ' Gefunden: ' + cov.projectsVisible + ' Projekte, davon ' + cov.projectsAudited +
        ' vollständig gelesen.'
      : '';

    document.getElementById('scope-banner').innerHTML =
      '<h2>Geltungsbereich</h2>Dieser Report zeigt ausschließlich Projekte, die für ' + who +
      ' sichtbar sind.' + counts +
      ' Projekte ohne Leseberechtigung erscheinen nicht in der Jira-Projektsuche und können ' +
      'hier deshalb auch nicht als fehlend ausgewiesen werden — für einen vollständigen Report ' +
      'braucht das Konto die globale Berechtigung <em>Jira administrieren</em>.';

    renderExcludedBanner(cov);

    if (!cov || cov.noKnownGaps) return;

    const banner = document.getElementById('gap-banner');
    const skipped = cov.skippedProjects || [];
    const partial = cov.partialProjects || [];
    const headline = skipped.length > 0
      ? skipped.length + ' Projekt(e) konnten nicht gelesen werden'
      : partial.length + ' Projekt(e) sind unvollständig';

    banner.innerHTML =
      '<h2>⚠ Dieser Report ist unvollständig — ' + headline + '</h2>' +
      'Die folgenden Zuordnungen fehlen. Behandle den Report nicht als vollständige ' +
      'Rechteübersicht, bevor das geklärt ist.' +
      gapList('Ohne jede Rollen-Information:', skipped) +
      gapList('Teilweise gelesen:', partial);
    banner.classList.remove('hidden');
  }

  function viaLabel(via) {
    return via.kind === 'group'
      ? '<span class="via-group">über Gruppe ' + esc(via.groupName) + '</span>'
      : 'direkt';
  }

  function renderOverview() {
    const rows = data.users
      .filter((u) => {
        const hay = (u.displayName + ' ' + (u.emailAddress || '')).toLowerCase();
        if (!hay.includes(filter)) return false;
        if (minAreas !== null && u.areaCount < minAreas) return false;
        if (maxAreas !== null && u.areaCount > maxAreas) return false;
        if (!matchesAny(groupFilter, userGroups(u))) return false;
        if (!matchesAny(roleFilter, userRoles(u))) return false;
        if (statusFilter && statusKey(u) !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const av = sortKey === 'statusLabel' ? statusLabel(a) : a[sortKey];
        const bv = sortKey === 'statusLabel' ? statusLabel(b) : b[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
        return String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv)) * sortDir;
      });
    document.getElementById('overview-body').innerHTML = rows
      .map((u) =>
        '<tr class="clickable" data-id="' + esc(u.accountId) + '">' +
        '<td>' + esc(u.displayName) + '</td>' +
        '<td>' + (u.emailAddress ? esc(u.emailAddress) : '—') + '</td>' +
        '<td class="status-' + statusKey(u) + '">' + statusLabel(u) + '</td>' +
        '<td class="num">' + u.areaCount + '</td></tr>')
      .join('');

    const total = data.users.length;
    const noun = total === 1 ? 'Benutzer' : 'Benutzern';
    document.getElementById('count').textContent =
      rows.length + ' von ' + total + ' ' + noun + ' angezeigt';
  }

  function showDetail(accountId) {
    const u = data.users.find((x) => x.accountId === accountId);
    if (!u) return;
    document.getElementById('detail-name').textContent = u.displayName;
    const groups = userGroups(u);
    document.getElementById('detail-sub').innerHTML =
      esc(u.emailAddress || '—') + ' · <span class="status-' + statusKey(u) + '">' +
      statusLabel(u) + '</span> · ' + u.areaCount + (u.areaCount === 1 ? ' Bereich' : ' Bereiche') +
      '<div class="groups">Rollen über Gruppen: ' +
      (groups.length > 0 ? groups.map((g) => esc(g)).join(', ') : 'keine (nur direkt)') +
      '</div>';
    document.getElementById('detail-body').innerHTML = u.assignments
      .map((a) =>
        '<tr><td>' + esc(a.projectName) + '</td><td><code>' + esc(a.projectKey) + '</code></td>' +
        '<td>' + esc(a.roleName) + '</td><td>' + viaLabel(a.via) + '</td></tr>')
      .join('');
    document.getElementById('overview').classList.add('hidden');
    document.getElementById('detail').classList.remove('hidden');
  }

  function showOverview() {
    document.getElementById('detail').classList.add('hidden');
    document.getElementById('overview').classList.remove('hidden');
  }

  document.getElementById('overview-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) showDetail(tr.getAttribute('data-id'));
  });
  document.getElementById('back').addEventListener('click', showOverview);
  document.getElementById('filter').addEventListener('input', (e) => {
    filter = e.target.value.toLowerCase();
    renderOverview();
  });
  ['min-areas', 'max-areas'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      minAreas = readBound('min-areas');
      maxAreas = readBound('max-areas');
      renderOverview();
    });
  });
  document.getElementById('status-filter').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    renderOverview();
  });
  document.getElementById('reset').addEventListener('click', () => {
    document.getElementById('filter').value = '';
    document.getElementById('min-areas').value = '';
    document.getElementById('max-areas').value = '';
    document.getElementById('status-filter').value = '';
    filter = '';
    minAreas = null;
    maxAreas = null;
    groupFilter = [];
    roleFilter = [];
    statusFilter = '';
    updateFacetButton('group');
    updateFacetButton('role');
    renderOverview();
  });
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (key === sortKey) sortDir *= -1; else { sortKey = key; sortDir = 1; }
      renderOverview();
    });
  });

  // Options come from the data, so a selection can never filter down to nothing.
  const facets = {
    group: {
      title: 'Gruppen filtern',
      button: 'group-btn',
      label: 'Gruppen',
      empty: 'Keine Gruppen — alle Rollen sind direkt zugewiesen.',
      options: [...new Set(data.users.flatMap(userGroups))].sort((a, b) => a.localeCompare(b)),
      get selected() { return groupFilter; },
      set selected(v) { groupFilter = v; },
    },
    role: {
      title: 'Rollen filtern',
      button: 'role-btn',
      label: 'Rollen',
      empty: 'Keine Rollen gefunden.',
      options: [...new Set(data.users.flatMap(userRoles))].sort((a, b) => a.localeCompare(b)),
      get selected() { return roleFilter; },
      set selected(v) { roleFilter = v; },
    },
  };

  const dialog = document.getElementById('facet-dialog');
  let openFacet = null;

  function updateFacetButton(key) {
    const facet = facets[key];
    const btn = document.getElementById(facet.button);
    const n = facet.selected.length;
    // The badge appears only when the filter is actually narrowing something —
    // a permanent "(0)" would read as a state rather than as "no filter".
    btn.innerHTML = esc(facet.label) + (n > 0 ? ' <span class="badge">' + n + '</span>' : '');
    btn.classList.toggle('active', n > 0);
  }

  function updateDialogSelectedCount() {
    const checked = [...document.querySelectorAll('#facet-list input:checked')].length;
    const total = document.querySelectorAll('#facet-list input').length;
    document.getElementById('facet-selected').textContent =
      total === 0 ? '' : checked + ' von ' + total + ' ausgewählt';
  }

  // The dialog edits a working copy: the live filter is only touched on
  // "Übernehmen", which makes "Abbrechen" and ESC correct by construction.
  function showFacetDialog(key) {
    const facet = facets[key];
    openFacet = key;
    document.getElementById('facet-title').textContent = facet.title;
    document.getElementById('facet-list').innerHTML =
      facet.options.length === 0
        ? '<p class="empty">' + esc(facet.empty) + '</p>'
        : facet.options
            .map((v) =>
              '<label><input type="checkbox" value="' + esc(v) + '"' +
              (facet.selected.includes(v) ? ' checked' : '') + '>' + esc(v) + '</label>')
            .join('');
    updateDialogSelectedCount();
    dialog.showModal();
  }

  function applyFacetDialog() {
    if (openFacet) {
      facets[openFacet].selected = [
        ...document.querySelectorAll('#facet-list input:checked'),
      ].map((i) => i.value);
      updateFacetButton(openFacet);
      renderOverview();
    }
    dialog.close();
  }

  document.querySelectorAll('.facet-btn').forEach((btn) => {
    btn.addEventListener('click', () => showFacetDialog(btn.getAttribute('data-facet')));
  });
  document.getElementById('facet-list').addEventListener('change', updateDialogSelectedCount);
  document.getElementById('facet-all').addEventListener('click', () => {
    document.querySelectorAll('#facet-list input').forEach((i) => { i.checked = true; });
    updateDialogSelectedCount();
  });
  document.getElementById('facet-none').addEventListener('click', () => {
    document.querySelectorAll('#facet-list input').forEach((i) => { i.checked = false; });
    updateDialogSelectedCount();
  });
  document.getElementById('facet-apply').addEventListener('click', applyFacetDialog);
  document.getElementById('facet-cancel').addEventListener('click', () => dialog.close());

  updateFacetButton('group');
  updateFacetButton('role');
  renderBanners();
  renderOverview();
})();
</script>
</body>
</html>`;
}
