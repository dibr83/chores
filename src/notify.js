'use strict';

// Sends one Pushover message. Set DRY_RUN=1 to log instead of sending.
async function sendPushover({ user, title, message, priority = 1 }) {
  if (process.env.DRY_RUN === '1') {
    console.log(`[dry-run] to=${user} | ${title}: ${message}`);
    return;
  }
  const token = process.env.PUSHOVER_APP_TOKEN;
  if (!token) throw new Error('PUSHOVER_APP_TOKEN is not set');

  const res = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, user, title, message, priority: String(priority) }),
  });
  if (!res.ok) throw new Error(`Pushover HTTP ${res.status}: ${await res.text()}`);
}

module.exports = { sendPushover };
