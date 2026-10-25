// A record from a helper is written in two branches (one adds a member, the other
// adds two) and returned; the caller reads each member, including one the other
// branch never wrote.
function newRec(n) {
  return { n: Number(n) };
}
function pick(flag, n) {
  var rec = newRec(n);
  if (flag) {
    rec.kind = 'big';
    return rec;
  }
  rec.kind = 'small';
  rec.half = n / 2;
  return rec;
}
function show(r) {
  return r.kind + ':' + r.n + ':' + r.half;
}
console.log(show(pick(true, 7)), show(pick(false, 9)));
var big = pick(true, 1);
console.log(big.half === undefined, big.kind, JSON.stringify(big));
