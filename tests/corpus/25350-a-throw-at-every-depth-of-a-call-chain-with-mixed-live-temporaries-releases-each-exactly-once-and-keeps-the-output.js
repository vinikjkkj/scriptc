// exception exits at several depths with strings, arrays, objects, closures, Maps and boxed numbers live; try/catch/finally nested; async rejection; repeated so a leak or a double release shows as a changed total
const log = [];
function boom(n) { if (n >= 0) throw new Error("e" + n); return n; }
function mk(tag) { return { tag, arr: [tag, tag + "1"], m: new Map([[tag, tag.length]]) }; }
function depth0(g) { const a = mk("a"); return g.f0(a.tag); }
function depth3(g, n) {
  const s = "s" + n;
  const a = [s, s + "x"];
  const o = { s, a };
  const c = () => s + a.length;
  const m = new Map([[s, o]]);
  g.p1(s);
  const t = s + a[0] + c();
  g.p2(t, o);
  const u = { t, m };
  g.p3(u, c);
  const w = [u, o, m];
  g.p4(w);
  return t + w.length;
}
function viaClosure(g) {
  const k = "k" + g.n;
  const mkf = (z) => () => { const q = [z, k]; g.deep(q, { z }); return q.length; };
  const f = mkf("z");
  return f();
}
function tryChain(g, n) {
  let out = "";
  try {
    const a = [n, "n" + n];
    try {
      const b = { a, s: "b" + n };
      g.f1(b);
      out += "no1";
    } catch (e1) {
      out += "c1:" + e1.message + ":" + a.length;
      const d = "d" + n;
      g.f2(d, a);
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
const g = JSON.parse('{"n":3}');
for (let r = 0; r < 300; r++) {
  const tests = [() => depth0(g), () => depth3(g, r), () => viaClosure(g), () => tryChain(g, r)];
  for (let i = 0; i < tests.length; i++) {
    try { log.push(String(tests[i]())); } catch (e) { log.push(i + ":" + e.constructor.name + ":" + e.message.length); }
  }
}
const h = {};
for (const l of log) h[l] = (h[l] || 0) + 1;
console.log(log.length, Object.keys(h).length, JSON.stringify(Object.entries(h).slice(0, 6)));
async function ar(g, n) { const s = "r" + n; const a = [s]; await null; g.pp(a, s); return s; }
(async () => {
  let c = 0;
  for (let i = 0; i < 50; i++) { try { await ar(g, i); } catch (e) { c += e.message.length; } }
  console.log("async", c);
})();
