// Object.assign onto dyn targets with sources of 0..70 members: the target is grown once to fit the copy, and every result must keep key order, last-write-wins values and the
// merge of duplicate keys; also self-assign, a target already large enough, repeated bulk assigns, and a source with a getter.
function obj(n, prefix, base) { const o = {}; for (let i = 0; i < n; i++) o[prefix + i] = base + i; return JSON.parse(JSON.stringify(o)); }
let out = [];
for (const tn of [0, 1, 3, 4, 17, 46, 63, 64, 65]) {
  for (const sn of [0, 1, 3, 4, 5, 17, 46, 64, 70]) {
    for (const dup of [false, true]) {
      const t = obj(tn, "t", 100);
      const s = obj(sn, dup ? "t" : "s", 1000);
      const r = Object.assign(t, s);
      const ks = Object.keys(r);
      out.push(tn + "/" + sn + "/" + dup + ":" + ks.length + ":" + ks[0] + ":" + ks[ks.length - 1] + ":" + JSON.stringify(r).length);
    }
  }
}
const self = obj(10, "x", 1); Object.assign(self, self); out.push("self:" + Object.keys(self).length);
const rep = obj(5, "r", 0);
for (let i = 0; i < 20; i++) Object.assign(rep, obj(6, "q" + i + "_", i));
out.push("rep:" + Object.keys(rep).length + ":" + Object.keys(rep).slice(-2).join(","));
const g = obj(4, "g", 0);
const withGetter = JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5}');
Object.defineProperty(withGetter, "f", { get() { return 6; }, enumerable: true, configurable: true });
const m = Object.assign(g, withGetter); out.push("getter:" + Object.keys(m).join(","));
const multi = Object.assign(obj(2, "m", 0), obj(5, "a", 0), obj(5, "b", 0), obj(5, "a", 9));
out.push("multi:" + Object.keys(multi).length + ":" + JSON.stringify(multi).length);
console.log(out.join("\n"));
