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
  input[type=search] { padding: .4rem .6rem; width: 100%; max-width: 320px; margin-bottom: 1rem; }
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
</style>
</head>
<body>
<h1>Jira Rollen-/Bereichs-Report</h1>
<div class="meta" id="meta"></div>
<div id="gap-banner" class="banner banner-gap hidden"></div>
<div id="scope-banner" class="banner banner-scope"></div>

<section id="overview">
  <input type="search" id="filter" placeholder="Nach Name oder E-Mail filtern…">
  <table>
    <thead><tr>
      <th data-sort="displayName">Name</th>
      <th data-sort="emailAddress">E-Mail</th>
      <th data-sort="areaCount" class="num">Anzahl Bereiche</th>
    </tr></thead>
    <tbody id="overview-body"></tbody>
  </table>
</section>

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

  function gapList(title, gaps) {
    if (gaps.length === 0) return '';
    return '<div><strong>' + title + '</strong><ul>' + gaps
      .map((g) =>
        '<li><code>' + esc(g.key) + '</code> ' + esc(g.name) +
        ' <span class="reason">— ' + esc(g.reasons.join('; ')) + '</span></li>')
      .join('') + '</ul></div>';
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
        return hay.includes(filter);
      })
      .sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
        return String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv)) * sortDir;
      });
    document.getElementById('overview-body').innerHTML = rows
      .map((u) =>
        '<tr class="clickable" data-id="' + esc(u.accountId) + '">' +
        '<td>' + esc(u.displayName) + '</td>' +
        '<td>' + (u.emailAddress ? esc(u.emailAddress) : '—') + '</td>' +
        '<td class="num">' + u.areaCount + '</td></tr>')
      .join('');
  }

  function showDetail(accountId) {
    const u = data.users.find((x) => x.accountId === accountId);
    if (!u) return;
    document.getElementById('detail-name').textContent = u.displayName;
    document.getElementById('detail-sub').textContent =
      (u.emailAddress || '—') + ' · ' + u.areaCount + ' Bereiche';
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
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (key === sortKey) sortDir *= -1; else { sortKey = key; sortDir = 1; }
      renderOverview();
    });
  });

  renderBanners();
  renderOverview();
})();
</script>
</body>
</html>`;
}
