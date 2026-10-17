'use strict';

const { DAYS, fmtLocal } = require('./time');

const DAY_LABELS = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

const OUTCOME_LABELS = {
  logged: 'Logged',
  repeat: 'Repeat tap (already logged)',
  inactive: 'Chore is off',
  unknown: 'Unknown tag',
};

const CELL = {
  logged: { text: '✓ Done', cls: 'ok' },
  missed: { text: '✗ Missed', cls: 'bad' },
  pending: { text: '… due later', cls: '' },
  off: { text: '–', cls: 'muted' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const CSS = `
body{font:16px system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#222}
section{border-bottom:1px solid #ddd;padding:.5rem 0}
fieldset{margin:.5rem 0;border:1px solid #ccc;border-radius:6px}
input{padding:.3rem;margin:.1rem}
button{padding:.3rem .7rem;margin:.2rem .2rem .2rem 0}
.bad{color:#b00020}.ok{color:#1b7f3b}.muted{color:#999}
code{background:#f3f3f3;padding:.1rem .3rem;border-radius:3px;word-break:break-all}
table{border-collapse:collapse;margin:.5rem 0;width:100%}
th,td{border:1px solid #bbb;padding:.3rem .45rem;text-align:left;vertical-align:top}
th.c,td.c{text-align:center;white-space:nowrap}
.sub{color:#555;font-size:.9rem}
@media print{
  body{max-width:none;margin:0;font-size:12px}
  .noprint{display:none!important}
  @page{size:landscape;margin:10mm}
  tr{break-inside:avoid}
}`;

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><h1>${esc(title)}</h1>${body}</body></html>`;
}

const scheduleLabel = (days) => (days === 'daily' ? 'every day' : days.split(',').map((d) => DAY_LABELS[d]).join(' '));

function choreForm(chore, recipients, action, submitLabel) {
  const isDaily = !chore || chore.days === 'daily';
  const picked = chore && !isDaily ? chore.days.split(',') : [];
  const chosen = new Set((chore?.recipients ?? []).map((r) => r.id));
  const recipBoxes = recipients.length
    ? recipients.map((r) => `<label><input type="checkbox" name="recipientIds" value="${r.id}" ${chosen.has(r.id) ? 'checked' : ''}> ${esc(r.name)}</label>`).join(' ')
    : '<em>Add a recipient first</em>';
  return `<form method="post" action="${esc(action)}">
  <p><label>Name <input name="name" required value="${esc(chore?.name)}"></label>
  <label>Deadline <input name="deadline" type="time" required value="${esc(chore?.deadline ?? '22:00')}"></label></p>
  <fieldset><legend>Schedule</legend>
    <label><input type="radio" name="schedule" value="daily" ${isDaily ? 'checked' : ''}> Every day</label>
    <label><input type="radio" name="schedule" value="custom" ${isDaily ? '' : 'checked'}> Only these days:</label>
    ${DAYS.map((d) => `<label><input type="checkbox" name="days" value="${d}" ${picked.includes(d) ? 'checked' : ''}> ${DAY_LABELS[d]}</label>`).join(' ')}
  </fieldset>
  <fieldset><legend>Notify if missed</legend>${recipBoxes}</fieldset>
  <button>${esc(submitLabel)}</button>
</form>`;
}

const PLACEHOLDER_BASE = /192\.168\.1\.50/;

function adminPage(chores, recipients, baseUrl) {
  const baseWarning = PLACEHOLDER_BASE.test(baseUrl)
    ? `<p class="bad">BASE_URL is still the example address (${esc(baseUrl)}). Set BASE_URL in .env to this VM's real address, then restart the service. The tag URLs below are wrong until you do.</p>`
    : '';
  const choreList = chores.length
    ? chores.map((c) => `<section>
  <h2>${esc(c.name)} ${c.active ? '' : '<span class="bad">(off)</span>'}</h2>
  <p>Due ${scheduleLabel(c.days)} by <strong>${esc(c.deadline)}</strong>.
     Notify: ${c.recipients.map((r) => esc(r.name)).join(', ') || '<em>nobody</em>'}</p>
  <p>NFC tag URL: <code>${esc(baseUrl)}/tap/${esc(c.tap_token)}</code></p>
  <form method="post" action="/chores/${c.id}/toggle" style="display:inline"><button>${c.active ? 'Turn off' : 'Turn on'}</button></form>
  <form method="post" action="/chores/${c.id}/delete" style="display:inline" onsubmit="return confirm('Delete this chore?')"><button>Delete</button></form>
  <details><summary>Edit</summary>${choreForm(c, recipients, `/chores/${c.id}`, 'Save changes')}</details>
</section>`).join('')
    : '<p>No chores yet.</p>';

  const recipList = recipients.length
    ? recipients.map((r) => `<li>${esc(r.name)}
  <form method="post" action="/recipients/${r.id}/delete" style="display:inline"><button>Remove</button></form></li>`).join('')
    : '<li><em>None yet</em></li>';

  return page('Chores', `
${baseWarning}
<p class="noprint"><a href="/scans">Scan log</a> · <a href="/report">Printable report</a></p>
<h2>Chores</h2>${choreList}
<details open><summary><strong>Add a chore</strong></summary>${choreForm(null, recipients, '/chores', 'Add chore')}</details>
<h2>Recipients</h2><ul>${recipList}</ul>
<form method="post" action="/recipients">
  <input name="name" placeholder="Name" required>
  <input name="pushover_key" placeholder="Pushover user key" required size="34">
  <button>Add recipient</button>
</form>
<p>To set up a tag, write the NFC tag URL above to it as a URL/Link record (NFC Tools app works).</p>`);
}

function scanRows(taps) {
  return taps.length
    ? taps.map((t) => `<tr><td>${esc(fmtLocal(t.tapped_at))}</td><td>${esc(t.chore_name)}</td>
  <td class="${t.outcome === 'logged' ? 'ok' : t.outcome === 'unknown' || t.outcome === 'inactive' ? 'bad' : ''}">${esc(OUTCOME_LABELS[t.outcome] ?? t.outcome)}</td></tr>`).join('')
    : '<tr><td colspan="3"><em>No taps in this range.</em></td></tr>';
}

function scansPage(taps) {
  return page('Scan log', `
<p class="noprint"><a href="/">← Admin</a> · <a href="/report">Printable report</a></p>
<p class="sub">Latest ${taps.length} taps, newest first. Times are local. Kept for 6 months.</p>
<table>
  <tr><th>Time</th><th>Chore</th><th>Result</th></tr>
  ${scanRows(taps)}
</table>`);
}

// Printable report: a chore-by-day status grid, totals, and the scan log for the same range.
function reportPage({ report, taps, bounds }) {
  const head = report.chores.map((c) => `<th class="c">${esc(c.name)}<br><span class="sub">by ${esc(c.deadline)}</span></th>`).join('');
  const grid = report.days.map((d) => `<tr><td>${esc(DAY_LABELS[d.dow])} ${esc(d.date)}</td>
  ${d.cells.map((s) => `<td class="c ${CELL[s].cls}">${CELL[s].text}</td>`).join('')}</tr>`).join('');
  const totals = report.totals.map((t) => `<tr><td>${esc(t.name)}</td><td class="c">${t.logged}</td>
  <td class="c bad">${t.missed}</td><td class="c">${t.pending}</td></tr>`).join('');

  return page(`Chore report ${report.from} to ${report.to}`, `
<form method="get" action="/report" class="noprint">
  <label>From <input type="date" name="from" value="${esc(report.from)}" min="${esc(bounds.earliest)}" max="${esc(bounds.today)}" required></label>
  <label>To <input type="date" name="to" value="${esc(report.to)}" min="${esc(bounds.earliest)}" max="${esc(bounds.today)}" required></label>
  <button>Show</button>
  <button type="button" onclick="window.print()">Print</button>
  <a href="/scans">Scan log</a> · <a href="/">Admin</a>
</form>
<p class="sub">Showing ${esc(report.from)} to ${esc(report.to)}. Days after today are not shown. History kept for 6 months.</p>

<h2>Status by day</h2>
<table>
  <tr><th>Day</th>${head}</tr>
  ${grid || '<tr><td colspan="99"><em>No days in range.</em></td></tr>'}
</table>

<h2>Totals</h2>
<table>
  <tr><th>Chore</th><th class="c">Done</th><th class="c">Missed</th><th class="c">Due later</th></tr>
  ${totals || '<tr><td colspan="4"><em>No active chores.</em></td></tr>'}
</table>
<p class="sub">Totals count only the days each chore was scheduled. Deleted chores are not shown in the grid.</p>

<h2>Scan log for this range</h2>
<table>
  <tr><th>Time</th><th>Chore</th><th>Result</th></tr>
  ${scanRows(taps)}
</table>`);
}

module.exports = { esc, page, adminPage, choreForm, scansPage, reportPage };
