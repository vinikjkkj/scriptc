// A JS `let` initialised with a number, reassigned a string in a branch, and
// read back with .length and .substring: the readDateTimeString shape from
// mysql2 (a fractional-seconds field padded then truncated).
function pad(num, value) {
  const s = value.toString();
  if (s.length >= num) return s;
  return ('000000' + s).slice(-num);
}
function fmtFraction(decimals, raw) {
  let ms = 0;
  ms = raw;
  if (decimals) {
    ms = pad(6, ms);
    if (ms.length > decimals) {
      ms = ms.substring(0, decimals);
    }
  }
  return ms;
}
console.log(fmtFraction(3, 1234567), fmtFraction(0, 42), fmtFraction(6, 5));
console.log(fmtFraction(2, 7) + '|' + fmtFraction(4, 123456));
