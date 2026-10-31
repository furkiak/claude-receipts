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

// ISO-8601 week number.
function isoWeek(date) {
  const day = Math.floor((startOfDay(date) - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY);
  return Math.floor(day / 7) + 1;
}

// "2024-W11": the label the weekly report is filed under.
function weekLabel(date) {
  return `${date.getUTCFullYear()}-W${String(isoWeek(date)).padStart(2, '0')}`;
}

module.exports = { daysBetween, addDays, isoWeek, weekLabel };
