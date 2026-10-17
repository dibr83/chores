'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('events');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { checkMissed } = require('../src/scheduler');
const { normalizeDays, isDueOn } = require('../src/time');
const { saveChore, addRecipient } = require('../src/chores');

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
