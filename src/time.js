'use strict';

const TZ = process.env.TZ_NAME || 'America/New_York';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

// Local date (YYYY-MM-DD), time (HH:mm) and weekday (sun..sat) in the household timezone.
function localParts(date = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    dow: p.weekday.toLowerCase().slice(0, 3),
  };
}

// Accepts 'daily', a day list, or any array of day codes. Returns 'daily' or 'mon,wed,...'.
function normalizeDays(input) {
  const list = [].concat(input ?? []).map(String);
  if (list.includes('daily') || DAYS.every((d) => list.includes(d))) return 'daily';
  const picked = DAYS.filter((d) => list.includes(d));
  if (picked.length === 0) throw new Error('Pick at least one day, or choose every day');
  return picked.join(',');
}

function isDueOn(days, dow) {
  return days === 'daily' || days.split(',').includes(dow);
}

function validTime(t) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

// Strict YYYY-MM-DD check, rejecting impossible dates like 2026-02-30.
function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Clamps to the last day of the target month (2026-08-31 minus 6 months is 2026-02-28).
function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

// Weekday for a YYYY-MM-DD date string. Timezone-independent: the date has no clock time.
function dowOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

// ISO timestamp -> "Oct 17, 9:05 AM" in the household timezone.
function fmtLocal(iso) {
  return timeFormatter.format(new Date(iso));
}

module.exports = {
  TZ, DAYS, localParts, normalizeDays, isDueOn, validTime,
  isDate, addDays, addMonths, dowOf, fmtLocal,
};
