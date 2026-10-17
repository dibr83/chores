'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('events');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { checkMissed } = require('../src/scheduler');
const {
  normalizeDays, isDueOn, isDate, addDays, addMonths, dowOf, fmtLocal, localParts,
} = require('../src/time');
const { saveChore, addRecipient, recordTap, listTaps, buildReport, pruneHistory } = require('../src/chores');

const KEY = 'a'.repeat(30);

test('day selection normalizes', () => {
  assert.equal(normalizeDays(['mon', 'wed']), 'mon,wed');
  assert.equal(normalizeDays(['daily']), 'daily');
  assert.equal(normalizeDays(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']), 'daily');
  assert.throws(() => normalizeDays([]));
  assert.equal(isDueOn('mon,wed', 'wed'), true);
  assert.equal(isDueOn('mon,wed', 'thu'), false);
  assert.equal(isDueOn('daily', 'thu'), true);
});

test('admin requires login, NFC tap does not, completion logs once', async () => {
  const db = open(':memory:');
  const app = createApp(db, { adminUser: 'admin', adminPass: 'pw', baseUrl: 'http://lan' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const rid = addRecipient(db, { name: 'Daniel', pushover_key: KEY });
    const cid = saveChore(db, { name: 'Feed Cat AM', deadline: '10:00', schedule: 'daily', recipientIds: [rid] });
    const { tap_token: token } = db.prepare('SELECT tap_token FROM chores WHERE id = ?').get(cid);

    assert.equal((await fetch(`${base}/`)).status, 401);
    const auth = 'Basic ' + Buffer.from('admin:pw').toString('base64');
    const admin = await fetch(`${base}/`, { headers: { Authorization: auth } });
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /NFC tag URL: <code>http:\/\/lan\/tap\//);

    const first = await fetch(`${base}/tap/${token}`);
    assert.equal(first.status, 200);
    assert.match(await first.text(), /Logged for/);

    const second = await fetch(`${base}/tap/${token}`);
    assert.match(await second.text(), /Already logged/);

    assert.equal((await fetch(`${base}/tap/not-a-real-token`)).status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('date helpers handle month ends, leap days and weekdays', () => {
  assert.equal(isDate('2026-02-28'), true);
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('10/19/2026'), false);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addMonths('2026-08-31', -6), '2026-02-28');
  assert.equal(addMonths('2026-10-17', -6), '2026-04-17');
  assert.equal(dowOf('2026-10-19'), 'mon');
  assert.equal(fmtLocal('2026-10-19T13:05:00Z'), 'Oct 19, 9:05 AM');
});

test('every tap is recorded with its outcome', () => {
  const db = open(':memory:');
  const cid = saveChore(db, { name: 'Feed Bird', deadline: '10:00', schedule: 'daily' });
  const { tap_token: token } = db.prepare('SELECT tap_token FROM chores WHERE id = ?').get(cid);
  const t1 = new Date('2026-10-19T13:00:00Z');

  assert.equal(recordTap(db, token, t1).outcome, 'logged');
  assert.equal(recordTap(db, token, new Date('2026-10-19T13:30:00Z')).outcome, 'repeat');
  assert.equal(recordTap(db, 'nope', t1).outcome, 'unknown');
  db.prepare('UPDATE chores SET active = 0 WHERE id = ?').run(cid);
  assert.equal(recordTap(db, token, t1).outcome, 'inactive');

  const taps = listTaps(db);
  assert.deepEqual(taps.map((t) => t.outcome), ['inactive', 'unknown', 'repeat', 'logged']);
  assert.equal(taps[3].chore_name, 'Feed Bird');
});

test('report shows done, missed, and due-later cells', () => {
  const db = open(':memory:');
  const cid = saveChore(db, { name: 'Cat Litter', deadline: '10:00', schedule: 'custom', days: ['mon'] });
  const { tap_token: token } = db.prepare('SELECT tap_token FROM chores WHERE id = ?').get(cid);
  recordTap(db, token, new Date('2026-10-12T13:00:00Z')); // logged Mon 2026-10-12

  // Mon 2026-10-19 at 9:00 local: before the deadline, so pending.
  const early = buildReport(db, { from: '2026-10-12', to: '2026-10-19', now: new Date('2026-10-19T13:00:00Z') });
  const monCells = early.days.filter((d) => d.dow === 'mon').map((d) => d.cells[0]);
  assert.deepEqual(monCells, ['logged', 'pending']);
  assert.equal(early.days.find((d) => d.dow === 'tue').cells[0], 'off');
  assert.deepEqual(early.totals[0], { name: 'Cat Litter', deadline: '10:00', logged: 1, missed: 0, pending: 1 });

  // Same day at 11:00 local: deadline passed, so missed.
  const late = buildReport(db, { from: '2026-10-12', to: '2026-10-19', now: new Date('2026-10-19T15:00:00Z') });
  assert.equal(late.totals[0].missed, 1);
  assert.equal(late.totals[0].pending, 0);
});

test('history older than 6 months is removed, recent history is kept', () => {
  const db = open(':memory:');
  const cid = saveChore(db, { name: 'Kitchen Sink Check', deadline: '23:00', schedule: 'daily' });
  const { tap_token: token } = db.prepare('SELECT tap_token FROM chores WHERE id = ?').get(cid);
  recordTap(db, token, new Date('2026-01-05T15:00:00Z')); // old
  recordTap(db, token, new Date('2026-10-10T15:00:00Z')); // recent

  const removed = pruneHistory(db, new Date('2026-10-19T15:00:00Z'));
  assert.equal(removed.taps, 1);
  assert.equal(removed.completions, 1);
  assert.deepEqual(listTaps(db).map((t) => t.date), ['2026-10-10']);
});

test('scan log and report pages require login and validate dates', async () => {
  const db = open(':memory:');
  saveChore(db, { name: 'Feed Cat PM', deadline: '19:00', schedule: 'daily' });
  const app = createApp(db, { adminUser: 'admin', adminPass: 'pw' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') };
  try {
    assert.equal((await fetch(`${base}/scans`)).status, 401);
    assert.equal((await fetch(`${base}/report`)).status, 401);
    assert.equal((await fetch(`${base}/scans`, { headers: auth })).status, 200);
    const today = localParts().date;
    const recent = addDays(today, -3);
    const report = await fetch(`${base}/report?from=${recent}&to=${today}`, { headers: auth });
    assert.equal(report.status, 200);
    assert.match(await report.text(), /Status by day/);
    assert.equal((await fetch(`${base}/report?from=bad&to=${today}`, { headers: auth })).status, 200); // falls back to defaults
    assert.equal((await fetch(`${base}/report?from=${today}&to=${recent}`, { headers: auth })).status, 400);
    assert.equal((await fetch(`${base}/report?from=${today}&to=${addDays(today, 1)}`, { headers: auth })).status, 400);
    assert.equal((await fetch(`${base}/report?from=2020-01-01&to=2020-01-05`, { headers: auth })).status, 400);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('missed chores alert once after deadline, only on scheduled days', async () => {
  const db = open(':memory:');
  const rid = addRecipient(db, { name: 'Ryan', pushover_key: KEY });
  saveChore(db, { name: 'Cat Litter', deadline: '10:00', schedule: 'custom', days: ['mon'], recipientIds: [rid] });
  saveChore(db, { name: 'Kitchen Sink Check', deadline: '23:00', schedule: 'daily', recipientIds: [rid] });

  const sent = [];
  const send = async (msg) => sent.push(msg);
  const log = { error() {} };

  // 2026-10-19 is a Monday. EDT is UTC-4.
  assert.deepEqual(await checkMissed(db, { now: new Date('2026-10-19T13:00:00Z'), send, log }), []); // 9:00 Mon
  assert.deepEqual(await checkMissed(db, { now: new Date('2026-10-19T15:00:00Z'), send, log }), ['Cat Litter']); // 11:00 Mon
  assert.deepEqual(await checkMissed(db, { now: new Date('2026-10-19T15:30:00Z'), send, log }), []); // no repeat
  assert.deepEqual(await checkMissed(db, { now: new Date('2026-10-20T15:00:00Z'), send, log }), []); // Tue: litter not scheduled
  assert.deepEqual(await checkMissed(db, { now: new Date('2026-10-20T03:30:00Z'), send, log }), ['Kitchen Sink Check']); // Mon 23:30

  assert.equal(sent.length, 2);
  assert.equal(sent[0].user, KEY);
  assert.equal(sent[0].title, 'Chore Missed');
  assert.equal(sent[0].message, "Cat Litter hasn't been logged today");
});

test('admin page warns when BASE_URL is still the example placeholder', async () => {
  const db = open(':memory:');
  const app = createApp(db, { adminUser: 'admin', adminPass: 'pw', baseUrl: 'http://192.168.1.50:3000' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const auth = 'Basic ' + Buffer.from('admin:pw').toString('base64');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { headers: { Authorization: auth } });
    assert.match(await res.text(), /still the example address/);
  } finally {
    server.close();
  }
});
