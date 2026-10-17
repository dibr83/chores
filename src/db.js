'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function open(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'chores.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipients (
      id           INTEGER PRIMARY KEY,
      name         TEXT NOT NULL,
      pushover_key TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chores (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      deadline  TEXT NOT NULL,              -- HH:mm, local time
      days      TEXT NOT NULL DEFAULT 'daily', -- 'daily' or comma list: mon,tue,...
      tap_token TEXT NOT NULL UNIQUE,       -- secret in the NFC tag URL
      active    INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS chore_recipients (
      chore_id     INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
      PRIMARY KEY (chore_id, recipient_id)
    );

    CREATE TABLE IF NOT EXISTS completions (
      id           INTEGER PRIMARY KEY,
      chore_id     INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
      date         TEXT NOT NULL,           -- YYYY-MM-DD, local
      completed_at TEXT NOT NULL,           -- ISO timestamp
      UNIQUE (chore_id, date)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
      date     TEXT NOT NULL,
      sent_at  TEXT NOT NULL,
      PRIMARY KEY (chore_id, date)
    );

    -- Every tap, including repeats and unknown tags. Keeps the chore name so history
    -- still reads correctly after a chore is deleted. chore_id is not a foreign key for that reason.
    CREATE TABLE IF NOT EXISTS tap_events (
      id         INTEGER PRIMARY KEY,
      tapped_at  TEXT NOT NULL,             -- ISO timestamp (UTC)
      date       TEXT NOT NULL,             -- YYYY-MM-DD, local
      chore_id   INTEGER,                   -- NULL for unknown tags
      chore_name TEXT NOT NULL,
      outcome    TEXT NOT NULL              -- logged | repeat | inactive | unknown
    );
    CREATE INDEX IF NOT EXISTS tap_events_date ON tap_events (date);
  `);
  return db;
}

module.exports = { open };
