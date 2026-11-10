// Dyn boxes shared and dropped in many ways: scalars, strings, arrays and objects held by several owners, reassigned and released in
// different orders, including cycles. A release that frees early or never frees shows under --sanitize (use-after-free or a leak) and as a
// wrong printed value.
const rows = [];
for (let i = 0; i < 400; i++) rows.push(JSON.parse('{"a":' + i + ',"s":"x' + i + '","t":[1,2,3],"n":null,"b":true}'));
let acc = 0;
for (let r = 0; r < 8; r++) {
  for (const x of rows) {
    const t = x.t, s = x.s, a = x.a;
    acc += a + s.length + t[1] + t.length;
    x.t = [t[0], t[1] + r, t[2]];
    x.alias = t;
  }
}
const keep = rows.filter((x) => x.a % 7 === 0).map((x) => x.alias);
rows.length = 0;
let k = 0;
for (const t of keep) k += t[0] + t[1] + t[2];
const a = JSON.parse('{"self":null,"v":[1,2]}');
a.self = a;
const b = JSON.parse('{"peer":null}');
b.peer = a;
a.other = b;
let c = 0;
for (let i = 0; i < 200; i++) { const x = JSON.parse('{"p":null}'); x.p = x; const y = [x, x]; c += y.length; }
console.log(acc, k, a.self === a, b.peer.v[1], c);
