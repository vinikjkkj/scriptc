import util from "node:util";
const H = JSON.parse('{"showHidden":true}');
const HD = JSON.parse('{"showHidden":true,"depth":0}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HK = JSON.parse('{"showHidden":true,"compact":true}');
const HZ = JSON.parse('{"showHidden":true,"compact":false}');
function show(v) { for (const o of [H, HD, HC, HK, HZ]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
function f(a, b) { "use strict"; }
const arrow = (x) => x;
const g = function* gen() {};
async function af() {}
const holder = { fn: f, list: [arrow] };
show(f);
show(arrow);
show(af);
show(holder);
show([f, f]);
