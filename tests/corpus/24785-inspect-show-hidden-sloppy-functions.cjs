const util = require("util");
const H = JSON.parse('{"showHidden":true}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HD = JSON.parse('{"showHidden":true,"depth":0}');
function show(v) { for (const o of [H, HC, HD]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
function decl(a, b) {}
const expr = function () {};
const arrow = () => {};
function strictf() { "use strict"; }
const obj = { meth() {}, fn: function named(x) {} };
async function af() {}
show(decl);
show(expr);
show(arrow);
show(strictf);
show(obj);
show(af);
show([decl, decl]);
console.log("%o", decl);
console.log("%o", { f: decl });
