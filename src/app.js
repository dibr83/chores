'use strict';

const crypto = require('crypto');
const express = require('express');
const {
  listChores, listRecipients, saveChore, toggleChore, deleteChore,
  addRecipient, deleteRecipient, recordTap, listTaps, buildReport, reportBounds,
} = require('./chores');
const { isDate, addDays } = require('./time');
const { esc, page, adminPage, scansPage, reportPage } = require('./views');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function basicAuth(user, pass) {
  return (req, res, next) => {
    const [scheme, b64] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && b64) {
      const [u, ...rest] = Buffer.from(b64, 'base64').toString().split(':');
      if (safeEqual(u, user) && safeEqual(rest.join(':'), pass)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="chores"').status(401).send('Login required');
  };
}

// Turns thrown validation errors into a readable page instead of a crash.
const handle = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    res.status(400).send(page('Could not save', `<p class="bad">${esc(err.message)}</p><p><a href="/">Back</a></p>`));
  }
};

function createApp(db, { adminUser, adminPass, baseUrl = 'http://localhost:3000' } = {}) {
  if (!adminUser || !adminPass) throw new Error('ADMIN_USER and ADMIN_PASS must be set');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  // NFC tap endpoint. No login: a tag can't send credentials, so the per-chore token is the secret.
  app.get('/tap/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const result = recordTap(db, req.params.token);
    if (result.outcome === 'unknown') {
      return res.status(404).send(page('Unknown tag', '<p class="bad">This tag is not linked to a chore.</p>'));
    }
    if (result.outcome === 'inactive') {
      return res.status(410).send(page(result.chore.name, '<p class="bad">This chore is turned off.</p>'));
    }
    const body = result.outcome === 'logged'
      ? `<p class="ok">Logged for ${esc(result.date)}.</p>${result.scheduled ? '' : '<p>Not scheduled today, but logged anyway.</p>'}`
      : `<p>Already logged for ${esc(result.date)}. Nice try.</p>`;
    res.send(page(result.chore.name, body));
  });

  // Admin area (LAN only; protected by basic auth).
  app.use(basicAuth(adminUser, adminPass));

  app.get('/', (req, res) => {
    res.send(adminPage(listChores(db), listRecipients(db), baseUrl));
  });

  app.get('/scans', (req, res) => {
    res.send(scansPage(listTaps(db)));
  });

  app.get('/report', (req, res) => {
    const bounds = reportBounds();
    const to = isDate(req.query.to) ? req.query.to : bounds.today;
    const from = isDate(req.query.from) ? req.query.from : addDays(to, -6);
    if (from > to) {
      return res.status(400).send(page('Report', '<p class="bad">"From" must be on or before "To".</p><p><a href="/report">Back</a></p>'));
    }
    if (to > bounds.today) {
      return res.status(400).send(page('Report', '<p class="bad">The report can\'t include future dates.</p><p><a href="/report">Back</a></p>'));
    }
    const span = (new Date(to) - new Date(from)) / 86_400_000 + 1;
    if (span > bounds.maxDays) {
      return res.status(400).send(page('Report', `<p class="bad">Pick a range of ${bounds.maxDays} days or less.</p><p><a href="/report">Back</a></p>`));
    }
    if (from < bounds.earliest) {
      return res.status(400).send(page('Report', `<p class="bad">History is kept for 6 months. Earliest date: ${esc(bounds.earliest)}.</p><p><a href="/report">Back</a></p>`));
    }
    const report = buildReport(db, { from, to });
    const taps = listTaps(db, { from: report.from, to: report.to });
    res.send(reportPage({ report, taps, bounds }));
  });

  app.post('/chores', handle((req, res) => {
    saveChore(db, req.body);
    res.redirect('/');
  }));

  app.post('/chores/:id', handle((req, res) => {
    saveChore(db, { ...req.body, id: req.params.id });
    res.redirect('/');
  }));

  app.post('/chores/:id/toggle', handle((req, res) => {
    toggleChore(db, req.params.id);
    res.redirect('/');
  }));

  app.post('/chores/:id/delete', handle((req, res) => {
    deleteChore(db, req.params.id);
    res.redirect('/');
  }));

  app.post('/recipients', handle((req, res) => {
    addRecipient(db, req.body);
    res.redirect('/');
  }));

  app.post('/recipients/:id/delete', handle((req, res) => {
    deleteRecipient(db, req.params.id);
    res.redirect('/');
  }));

  return app;
}

module.exports = { createApp };
