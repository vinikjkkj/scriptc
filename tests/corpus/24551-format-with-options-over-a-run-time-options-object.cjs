// util.formatWithOptions(opts, ...args) where `opts` is an object that exists only at run time, with an open key set (debug's
// exports.inspectOpts, assembled from DEBUG_* environment keys). The honoured keys apply to the rest-argument
// inspections and to %O, unknown keys are ignored, and the options do not leak into the next call.
const util = require("util");
const opts = JSON.parse('{"depth":0,"breakLength":40,"unrelated":true,"hideDate":1}');
const nested = { a: { b: { c: 1 } }, list: [1, 2, [3, [4]]] };
console.log(util.formatWithOptions(opts, "%s|%d|%j", "text", 42, { k: [1] }, nested));
console.log(util.formatWithOptions(opts, "tail", nested, [nested]));
console.log(util.formatWithOptions({ depth: 5, compact: 1 }, "lit", nested));
console.log(util.format("after", nested));
console.log(util.formatWithOptions(opts).length);
const wide = JSON.parse('{"depth":3}');
console.log(util.formatWithOptions(wide, "%O", nested), util.formatWithOptions(wide, nested));
const more = JSON.parse('{"maxArrayLength":2,"maxStringLength":4,"numericSeparator":true,"sorted":true,"compact":1,"depth":5}');
const item = { z: "abcdefghij", n: 1234567.891, list: [1, 2, 3, 4], a: 1 };
console.log(util.formatWithOptions(more, "m", item));
console.log(util.formatWithOptions(more, "%s|%d|%O", item, 1234567, item));
console.log(util.formatWithOptions(JSON.parse('{"breakLength":10,"compact":false}'), "%s", { a: { b: 1 }, c: [1, 2] }, item.list));
console.log(util.formatWithOptions(JSON.parse('{"depth":null}'), "inf", { a: { b: { c: { d: { e: 1 } } } } }));
