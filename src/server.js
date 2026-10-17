'use strict';

const { open } = require('./db');
const { createApp } = require('./app');
const { startScheduler } = require('./scheduler');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const db = open();
const app = createApp(db, {
  adminUser: process.env.ADMIN_USER,
  adminPass: process.env.ADMIN_PASS,
  baseUrl: process.env.BASE_URL || `http://localhost:${PORT}`,
});

app.listen(PORT, HOST, () => console.log(`Chores listening on ${HOST}:${PORT}`));
startScheduler(db);
