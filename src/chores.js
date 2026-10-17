'use strict';

const crypto = require('crypto');
const {
  normalizeDays, validTime, localParts, isDueOn, addDays, addMonths, dowOf,
} = require('./time');

const newToken = () => crypto.randomBytes(16).toString('hex');

function listChores(db) {
  const chores = db.prepare('SELECT * FROM chores ORDER BY deadline, name').all();
  const links = db.prepare(`
    SELECT cr.chore_id, r.id, r.name
    FROM chore_recipients cr JOIN recipients r ON r.id = cr.recipient_id
    ORDER BY r.name`).all();
  return chores.map((c) => ({ ...c, recipients: links.filter((l) => l.chore_id === c.id) }));
}

function listRecipients(db) {
  return db.prepare('SELECT id, name, pushover_key FROM recipients ORDER BY name').all();
}

function findByToken(db, token) {
  return db.prepare('SELECT * FROM chores WHERE tap_token = ?').get(String(token));
}

// Create (no id) or update (id) a chore and its recipients. Returns the chore id.
function saveChore(db, input) {
  const name = String(input.name ?? '').trim();
  const deadline = String(input.deadline ?? '');
  if (!name) throw new Error('Chore name is required');
  if (!validTime(deadline)) throw new Error('Deadline must be a 24-hour time like 10:00 or 23:00');
  const days = input.schedule === 'daily' ? 'daily' : normalizeDays(input.days);
  const recipientIds = [].concat(input.recipientIds ?? []).map(Number).filter(Boolean);

  return db.transaction(() => {
    let id = input.id ? Number(input.id) : null;
    if (id) {
      const res = db.prepare('UPDATE chores SET name = ?, deadline = ?, days = ? WHERE id = ?')
        .run(name, deadline, days, id);
      if (res.changes === 0) throw new Error('Chore not found');
    } else {
      id = Number(db.prepare('INSERT INTO chores (name, deadline, days, tap_token) VALUES (?, ?, ?, ?)')
        .run(name, deadline, days, newToken()).lastInsertRowid);
    }
    db.prepare('DELETE FROM chore_recipients WHERE chore_id = ?').run(id);
    const link = db.prepare('INSERT INTO chore_recipients (chore_id, recipient_id) VALUES (?, ?)');
    for (const rid of recipientIds) link.run(id, rid);
    return id;
  })();
}

function toggleChore(db, id) {
  db.prepare('UPDATE chores SET active = 1 - active WHERE id = ?').run(Number(id));
}

function deleteChore(db, id) {
  db.prepare('DELETE FROM chores WHERE id = ?').run(Number(id));
}

function addRecipient(db, { name, pushover_key }) {
  const n = String(name ?? '').trim();
  const key = String(pushover_key ?? '').trim();
  if (!n) throw new Error('Recipient name is required');
  if (!/^[A-Za-z0-9]{30}$/.test(key)) throw new Error('Pushover user key should be 30 letters/numbers');
  return Number(db.prepare('INSERT INTO recipients (name, pushover_key) VALUES (?, ?)').run(n, key).lastInsertRowid);
}

function deleteRecipient(db, id) {
  db.prepare('DELETE FROM recipients WHERE id = ?').run(Number(id));
}

const PRUNE_MONTHS = 6;
const MAX_REPORT_DAYS = 186;

// Handles one NFC tap. Logs it once per chore per local day, and records every tap in tap_events.
// outcome: logged | repeat | inactive | unknown
function recordTap(db, token, now = new Date()) {
  const { date, dow } = localParts(now);
  const tapped_at = now.toISOString();
  const addEvent = (choreId, choreName, outcome) => db.prepare(
    'INSERT INTO tap_events (tapped_at, date, chore_id, chore_name, outcome) VALUES (?, ?, ?, ?, ?)'
  ).run(tapped_at, date, choreId, choreName, outcome);

  const chore = findByToken(db, token);
  if (!chore) {
    addEvent(null, 'Unknown tag', 'unknown');
    return { outcome: 'unknown' };
  }
  if (!chore.active) {
    addEvent(chore.id, chore.name, 'inactive');
    return { outcome: 'inactive', chore, date };
  }
  const created = db.prepare(
    'INSERT OR IGNORE INTO completions (chore_id, date, completed_at) VALUES (?, ?, ?)'
  ).run(chore.id, date, tapped_at).changes === 1;
  const outcome = created ? 'logged' : 'repeat';
  addEvent(chore.id, chore.name, outcome);
  return { outcome, chore, date, scheduled: isDueOn(chore.days, dow) };
}

function listTaps(db, { from, to } = {}) {
  if (from && to) {
    return db.prepare('SELECT * FROM tap_events WHERE date BETWEEN ? AND ? ORDER BY tapped_at DESC, id DESC')
      .all(from, to);
  }
  return db.prepare('SELECT * FROM tap_events ORDER BY id DESC LIMIT 200').all();
}

// Per-day, per-chore status for the printable report. Only days up to today are included.
// Cell status: logged | missed | pending (today, before deadline) | off (not scheduled that day)
function buildReport(db, { from, to, now = new Date() }) {
  const today = localParts(now);
  const end = to > today.date ? today.date : to;
  const chores = db.prepare('SELECT * FROM chores WHERE active = 1 ORDER BY deadline, name').all();
  const done = new Set(
    db.prepare('SELECT chore_id, date FROM completions WHERE date BETWEEN ? AND ?').all(from, end)
      .map((r) => `${r.chore_id}|${r.date}`)
  );

  const days = [];
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const dow = dowOf(d);
    const cells = chores.map((c) => {
      if (!isDueOn(c.days, dow)) return 'off';
      if (done.has(`${c.id}|${d}`)) return 'logged';
      if (d === today.date && today.time < c.deadline) return 'pending';
      return 'missed';
    });
    days.push({ date: d, dow, cells });
  }

  const totals = chores.map((c, i) => {
    const count = (s) => days.reduce((n, day) => n + (day.cells[i] === s ? 1 : 0), 0);
    return { name: c.name, deadline: c.deadline, logged: count('logged'), missed: count('missed'), pending: count('pending') };
  });
  return { from, to: end, chores, days, totals };
}

// Keeps history for PRUNE_MONTHS. Returns how many rows were removed.
function pruneHistory(db, now = new Date()) {
  const cutoff = addMonths(localParts(now).date, -PRUNE_MONTHS);
  return db.transaction(() => ({
    taps: db.prepare('DELETE FROM tap_events WHERE date < ?').run(cutoff).changes,
    completions: db.prepare('DELETE FROM completions WHERE date < ?').run(cutoff).changes,
    alerts: db.prepare('DELETE FROM alerts WHERE date < ?').run(cutoff).changes,
  }))();
}

// Earliest date the report may show, and the default range (last 7 days).
function reportBounds(now = new Date()) {
  const today = localParts(now).date;
  return { today, earliest: addMonths(today, -PRUNE_MONTHS), maxDays: MAX_REPORT_DAYS };
}

module.exports = {
  listChores, listRecipients, findByToken, saveChore, toggleChore, deleteChore,
  addRecipient, deleteRecipient, recordTap, listTaps, buildReport, pruneHistory, reportBounds,
};
