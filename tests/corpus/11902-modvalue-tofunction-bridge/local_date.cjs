'use strict';

// Shape of mysql2's lib/parsers/local_date.js: a module whose exports object
// carries functions (with module-level state) and constants.
const EPOCH_YEAR = 1970;
const MAX_CACHED = 4096;
const hourOffsets = new Map();
let lastTimezone = 'UTC';

function checkTimezone() {
  const timezone = 'UTC';
  if (timezone !== lastTimezone) {
    lastTimezone = timezone;
    hourOffsets.clear();
  }
  return hourOffsets.size;
}

function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  return Math.floor(y / 4) * 1461 + month * 31 + day - EPOCH_YEAR;
}

function localDate(year, month, day, hours, minutes, seconds, milliseconds) {
  if (hourOffsets.size >= MAX_CACHED) hourOffsets.clear();
  hourOffsets.set(hours, 0);
  return new Date(year, month - 1, day, hours, minutes, seconds, milliseconds);
}

function usesLocalDate(field) {
  return field.columnType === 'DATETIME';
}

module.exports = {
  localDate,
  checkTimezone,
  usesLocalDate,
  _daysFromCivil: daysFromCivil,
  _clear() {
    hourOffsets.clear();
  },
  EPOCH_YEAR,
  MAX_CACHED,
};
