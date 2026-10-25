// A record returned by a helper gets a member added after its own members: the
// keys keep insertion order, a second write to an existing key does not move it,
// and a member written from an expression is read back.
function newRecord(n) {
  return { b: Number(n), a: Number(n) * 2 };
}
function build(n) {
  var rec = newRecord(n);
  rec.z = 'last';
  rec.b = n + 1;
  rec.m = rec.a + rec.b;
  return rec;
}
var r = build(4);
console.log(Object.keys(r).join(','), r.b, r.a, r.m, r.z);
console.log(JSON.stringify(r));
