'use strict';

const crypto = require('crypto');
const { normalizeDays, validTime, localParts, isDueOn } = require('./time');

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

// Logs today's completion once per chore per local day.
function recordCompletion(db, chore, now = new Date()) {
  const { date, dow } = localParts(now);
  const info = db.prepare(
    'INSERT OR IGNORE INTO completions (chore_id, date, completed_at) VALUES (?, ?, ?)'
  ).run(chore.id, date, now.toISOString());
  return { date, created: info.changes === 1, scheduled: isDueOn(chore.days, dow) };
}

module.exports = {
  listChores, listRecipients, findByToken, saveChore, toggleChore, deleteChore,
  addRecipient, deleteRecipient, recordCompletion,
};
