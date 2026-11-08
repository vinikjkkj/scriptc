import util from "node:util";
// Options that only exist at run time (JSON.parse answers unknown): read by the runtime exactly as Node reads them.
const mk = (s) => JSON.parse(s);
const data = { list: Array.from({ length: 120 }, (_, i) => i), words: ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"], deep: { a: { b: { c: { d: { e: 1 } } } } }, text: "x".repeat(40) };
for (const o of ['{}', '{"depth":0}', '{"depth":null}', '{"breakLength":30}', '{"compact":1}', '{"compact":false}', '{"maxArrayLength":5}', '{"maxStringLength":10}', '{"sorted":true}', '{"depth":1,"breakLength":Infinity}'.replace("Infinity", "1e9"), '{"numericSeparator":true}']) {
  console.log(o, util.inspect(data, mk(o)));
}
const keyOrder = mk('{"depth":2}');
console.log(util.inspect({ z: 1, a: [1, { q: 2 }], m: new Map() }, keyOrder));
console.log(util.inspect(1234567.891, mk('{"numericSeparator":true}')), util.inspect([1.5, -0, 5n], mk('{"compact":false}')));
