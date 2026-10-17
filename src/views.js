'use strict';

const { DAYS } = require('./time');

const DAY_LABELS = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const CSS = `
body{font:16px system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#222}
section{border-bottom:1px solid #ddd;padding:.5rem 0}
fieldset{margin:.5rem 0;border:1px solid #ccc;border-radius:6px}
input{padding:.3rem;margin:.1rem}
button{padding:.3rem .7rem;margin:.2rem .2rem .2rem 0}
.bad{color:#b00020}.ok{color:#1b7f3b}
code{background:#f3f3f3;padding:.1rem .3rem;border-radius:3px;word-break:break-all}`;

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

function adminPage(chores, recipients, baseUrl) {
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

module.exports = { esc, page, adminPage, choreForm };
