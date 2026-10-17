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

module.exports = { TZ, DAYS, localParts, normalizeDays, isDueOn, validTime };
