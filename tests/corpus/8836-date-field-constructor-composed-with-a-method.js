"use strict";
// new Date(y, m, d, h, mi, s, ms) is LOCAL time. It composes with .getTime() and .toISOString()
// like any Date value (mysql2's localTime reads the offset the constructor applies).
const d = new Date(2020, 1, 29);
console.log(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
console.log(new Date(2021, 11, 31, 23, 59, 58, 7).getTime() === new Date(2021, 11, 31, 23, 59, 58, 7).getTime());
console.log(new Date(2020, 5, 15).getTime() - Date.UTC(2020, 5, 15) === new Date(2020, 5, 15).getTimezoneOffset() * 60000);
console.log(new Date(99, 0, 1).getFullYear(), new Date(2020, 12, 1).getMonth(), new Date(2020, 0, 32).getDate());
console.log(new Date(2020, 5, 15, 12, 30, 15, 500).toISOString() === new Date(Date.UTC(2020, 5, 15, 12, 30, 15, 500) + new Date(2020, 5, 15, 12, 30, 15, 500).getTimezoneOffset() * 60000).toISOString());
function localTime(wallTime) {
  const wall = new Date(wallTime);
  return new Date(
    wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(),
    wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), wall.getUTCMilliseconds(),
  ).getTime();
}
for (const t of [0, 86400000 * 365, Date.UTC(2020, 2, 8, 12), Date.UTC(2020, 10, 1, 5, 30)]) {
  const off = t - localTime(t);
  console.log(off === new Date(t).getTimezoneOffset() * 60000 || off);
}
console.log(new Date(2020, 0, 1, 0, 0, 0, 0).getTime() === new Date(2020, 0, 1).getTime());
