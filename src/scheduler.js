'use strict';

const { localParts, isDueOn } = require('./time');
const { sendPushover } = require('./notify');

// Chores that are scheduled today, past their deadline, not logged today, and not yet alerted.
function findMissed(db, now = new Date()) {
  const { date, time, dow } = localParts(now);
  return db.prepare(`
    SELECT c.* FROM chores c
    WHERE c.active = 1
      AND c.deadline <= ?
      AND NOT EXISTS (SELECT 1 FROM completions k WHERE k.chore_id = c.id AND k.date = ?)
      AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.chore_id = c.id AND a.date = ?)
  `).all(time, date, date).filter((c) => isDueOn(c.days, dow));
}

// Sends one "Chore Missed" alert per chore per day to each linked recipient.
// Returns the names of chores alerted on this run.
async function checkMissed(db, { now = new Date(), send = sendPushover, log = console } = {}) {
  const { date } = localParts(now);
  const alerted = [];
  for (const chore of findMissed(db, now)) {
    const recipients = db.prepare(`
      SELECT r.* FROM chore_recipients cr
      JOIN recipients r ON r.id = cr.recipient_id
      WHERE cr.chore_id = ?`).all(chore.id);
    for (const r of recipients) {
      try {
        await send({
          user: r.pushover_key,
          title: 'Chore Missed',
          message: `${chore.name} hasn't been logged today`,
          priority: 1,
        });
      } catch (err) {
        log.error(`Alert to ${r.name} for "${chore.name}" failed: ${err.message}`);
      }
    }
    // Recorded even if a send failed, so a bad key doesn't spam everyone every minute.
    db.prepare('INSERT OR IGNORE INTO alerts (chore_id, date, sent_at) VALUES (?, ?, ?)')
      .run(chore.id, date, now.toISOString());
    alerted.push(chore.name);
  }
  return alerted;
}

function startScheduler(db, { intervalMs = 60_000, send = sendPushover } = {}) {
  const tick = () => checkMissed(db, { send })
    .then((names) => names.length && console.log(`Missed chores alerted: ${names.join(', ')}`))
    .catch((err) => console.error('Scheduler error:', err));
  tick();
  return setInterval(tick, intervalMs);
}

module.exports = { findMissed, checkMissed, startScheduler };
