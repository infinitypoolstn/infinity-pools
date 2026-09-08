// Calendar helpers: build an .ics (iCalendar) file for a scheduled event, plus an
// "Add to Google Calendar" URL. Events store date as 'YYYY-MM-DD' and an optional
// time as 'HH:MM' (empty = all-day). Multi-day is expressed via endDate. The app's
// timezone is America/Chicago (matches the cron and Nashville, TN office).
const TZID = 'America/Chicago';
const DOMAIN = 'infinitypoolstn.com';

const pad = n => String(n).padStart(2, '0');

// 'YYYY-MM-DD' -> 'YYYYMMDD'
const dateCompact = d => String(d || '').replace(/-/g, '');

// Add whole days to a 'YYYY-MM-DD' string, returning 'YYYYMMDD' (UTC-safe math).
function addDaysCompact(d, days) {
  const [y, m, dd] = String(d).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

// UTC timestamp for DTSTAMP, e.g. 20260904T130000Z. Pass a Date (defaults to now).
function utcStamp(dateObj) {
  const d = dateObj || new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// Escape text per RFC 5545 (commas, semicolons, backslashes, newlines).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Default duration for a timed event with no end time, in minutes.
const DEFAULT_MINUTES = 60;

// Compute '+N minutes' local clock time from 'HH:MM', rolling over past midnight
// within the same day is fine for a 1h default (clamped so it doesn't wrap the day).
function timeEnd(time, minutes) {
  const [h, m] = String(time).split(':').map(Number);
  let total = h * 60 + m + minutes;
  if (total >= 24 * 60) total = 24 * 60 - 1; // keep DTEND on the same day
  return `${pad(Math.floor(total / 60))}${pad(total % 60)}00`;
}

/**
 * Build an iCalendar (.ics) string for a single event. `stampDate` is optional and
 * only used to make DTSTAMP deterministic in tests.
 */
function buildEventIcs(event, client, stampDate) {
  const uid = (event.id || Math.random().toString(36).slice(2)) + '@' + DOMAIN;
  const title = event.title || 'Event';
  const location = (client && client.address) || '';
  const description = event.details || '';

  let dtStart, dtEnd;
  if (event.time) {
    // Timed event — local time in the office timezone; +1h default end.
    const startClock = String(event.time).replace(':', '') + '00';
    dtStart = `DTSTART;TZID=${TZID}:${dateCompact(event.date)}T${startClock}`;
    dtEnd = `DTEND;TZID=${TZID}:${dateCompact(event.date)}T${timeEnd(event.time, DEFAULT_MINUTES)}`;
  } else {
    // All-day event. DTEND is exclusive, so add a day past the (single or multi-day) end.
    const endDay = (event.endDate && event.endDate > event.date) ? event.endDate : event.date;
    dtStart = `DTSTART;VALUE=DATE:${dateCompact(event.date)}`;
    dtEnd = `DTEND;VALUE=DATE:${addDaysCompact(endDay, 1)}`;
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Infinity Pools//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + utcStamp(stampDate),
    dtStart,
    dtEnd,
    'SUMMARY:' + esc(title),
    description ? 'DESCRIPTION:' + esc(description) : null,
    location ? 'LOCATION:' + esc(location) : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  // RFC 5545 requires CRLF line endings.
  return lines.join('\r\n') + '\r\n';
}

/** Build an "Add to Google Calendar" URL for an event. */
function googleCalendarUrl(event, client) {
  let dates;
  if (event.time) {
    // Google's TEMPLATE link takes UTC times when suffixed with Z, or local naive
    // times with a ctz param. Use ctz + naive local times so DST is handled by Google.
    const start = dateCompact(event.date) + 'T' + String(event.time).replace(':', '') + '00';
    const end = dateCompact(event.date) + 'T' + timeEnd(event.time, DEFAULT_MINUTES);
    dates = start + '/' + end;
  } else {
    const endDay = (event.endDate && event.endDate > event.date) ? event.endDate : event.date;
    dates = dateCompact(event.date) + '/' + addDaysCompact(endDay, 1);
  }
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || 'Event',
    dates,
    ctz: TZID,
  });
  if (event.details) params.set('details', event.details);
  if (client && client.address) params.set('location', client.address);
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

module.exports = { buildEventIcs, googleCalendarUrl };
