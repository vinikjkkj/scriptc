import util from "node:util";
const SP = JSON.parse('{"showProxy":true}');
const SPD = JSON.parse('{"showProxy":true,"depth":0}');
const SPF = JSON.parse('{"showProxy":false}');
const SPC = JSON.parse('{"showProxy":true,"colors":true}');
const SPK = JSON.parse('{"showProxy":true,"compact":true}');
function mk(t, h) { return new Proxy(t, h); }
function show(v) { for (const o of [SP, SPD, SPF, SPC, SPK]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
show(mk({ a: 1, b: [1, 2] }, {}));
show(mk([1, 2, 3], { get(t, k) { return t[k]; } }));
show(mk({ a: 1 }, { has() { return true; } }));
show({ wrapped: mk({ z: 1 }, {}), arr: [mk([1], {})] });
show(mk(mk({ n: 1 }, {}), { deep: true }));
show(mk({ x: "y".repeat(50), w: "z".repeat(40) }, { trap: "q".repeat(30) }));
const r = JSON.parse("0") || Proxy.revocable({ a: 1 }, {});
r.revoke();
show(r.proxy);
show([r.proxy]);
show(mk(function f() {}, {}));
console.log(util.formatWithOptions(SP, "%O|%s", mk({ a: 1 }, {}), mk({ b: 2 }, {})));
