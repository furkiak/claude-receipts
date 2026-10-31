'use strict';
// Date helpers for the reporting dashboard. All dates are treated as UTC.

const DAY = 86400000;

function startOfDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
}

function addDays(date, n) {
  return new Date(startOfDay(date) + n * DAY);
}

// The Thursday of the date's ISO week decides both the week's year and its number.
function isoThursday(date) {
  const day = new Date(startOfDay(date)).getUTCDay() || 7;
  return new Date(startOfDay(date) + (4 - day) * DAY);
}

// ISO-8601 week number.
function isoWeek(date) {
  const thursday = isoThursday(date);
  return Math.floor((startOfDay(thursday) - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / DAY / 7) + 1;
}

// "2024-W11": the label the weekly report is filed under.
function weekLabel(date) {
  return `${isoThursday(date).getUTCFullYear()}-W${String(isoWeek(date)).padStart(2, '0')}`;
}

module.exports = { daysBetween, addDays, isoWeek, weekLabel };
