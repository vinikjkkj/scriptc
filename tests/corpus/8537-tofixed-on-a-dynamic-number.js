// Number.prototype.toFixed over an untyped receiver (postgres-interval:
// `(value + this.milliseconds / 1000).toFixed(6).replace(...)`), and the names a
// boolean or string does not have.
'use strict';
function show(f) {
  try {
    console.log(JSON.stringify(f()));
  } catch (e) {
    console.log(e.name + ': ' + e.message);
  }
}
function fixed(x, d) { return x.toFixed(d); }
function fixed0(x) { return x.toFixed(); }
const nums = JSON.parse('[1.005, 2.5, -2.5, 0, 1e21, 123.456, -0.0001, 0.5, 1.45, 1000000000000000128]');
for (const n of nums) {
  show(() => fixed0(n));
  show(() => fixed(n, 2));
  show(() => fixed(n, 6));
  show(() => fixed(n, '1'));
}
show(() => fixed(1, 101));
show(() => fixed(1, -1));
show(() => fixed(1, undefined));
show(() => fixed(true, 2));
show(() => fixed('3', 2));
show(() => fixed(null, 2));
const seconds = JSON.parse('{"seconds": 4, "milliseconds": 250}');
function render(value, ms) { return (value + ms / 1000).toFixed(6).length; }
console.log(render(seconds.seconds, seconds.milliseconds));
const flag = JSON.parse('true');
show(() => flag.toFixed(2));
