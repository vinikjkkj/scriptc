// the k-th of several dynamic calls throws, so exits with 1..5 live temporaries (strings, arrays, records, closures, Maps) run in turn, plus try/finally and async rejection; repeated so a leak or a double release changes the totals
let which = -1;
const g = {
  n: 3,
  step(i, x) { if (i === which) throw new Error("e" + i); return x; },
};
function seq(g, r) {
  const s = "s" + r;
  g.step(0, s);
  const a = [s, s + "x"];
  g.step(1, a);
  const o = { s, a };
  const c = () => s + a.length;
  g.step(2, o);
  const m = new Map([[s, o]]);
  g.step(3, m);
  const t = s + a[0] + c();
  const u = { t, m, c };
  g.step(4, u);
  const w = [u, o, m, t];
  g.step(5, w);
  return t + w.length;
}
function viaClosure(g, r) {
  const k = "k" + r;
  const mkf = (z) => () => { const q = [z, k]; g.step(6, q); const p = { z, q }; g.step(7, p); return q.length + p.z.length; };
  return mkf("z")();
}
function tryChain(g, r) {
  let out = "";
  try {
    const a = [r, "n" + r];
    g.step(8, a);
    try {
      const b = { a, s: "b" + r };
      g.step(9, b);
      out += "no1";
    } catch (e1) {
      out += "c1:" + e1.message + ":" + a.length;
      const d = "d" + r;
      g.step(10, [d, a]);
    } finally {
      out += "|f1";
    }
  } catch (e2) {
    out += "|c2:" + e2.message;
  } finally {
    out += "|f2";
  }
  return out;
}
const log = [];
for (let r = 0; r < 40; r++) {
  for (which = -1; which <= 10; which++) {
    for (const f of [seq, viaClosure, tryChain]) {
      try { log.push(String(f(g, r))); } catch (e) { log.push(f.name + ":" + which + ":" + e.message); }
    }
  }
}
const h = {};
for (const l of log) h[l.length > 24 ? l.slice(0, 24) : l] = (h[l.length > 24 ? l.slice(0, 24) : l] || 0) + 1;
console.log(log.length, Object.keys(h).length, JSON.stringify(Object.entries(h).slice(0, 5)));
async function ar(gg, r) { const s = "r" + r; const a = [s]; await null; gg.step(11, a); const b = { s }; gg.step(12, b); return s; }
(async () => {
  let c = 0;
  for (let i = 0; i < 30; i++) { which = 11 + (i % 3); try { await ar(g, i); } catch (e) { c += e.message.length; } }
  console.log("async", c);
})();
