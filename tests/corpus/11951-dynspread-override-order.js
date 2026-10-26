// Spread override order with a CALL source: a later key keeps its position but takes the later value; an earlier spread is overridden by a later literal key.
// The source is built by JSON.parse, so its keys are a run-time fact and the compiler cannot prove which are present.
function mk(v) {
  return JSON.parse('{"a":' + v + ',"x":"fromA","b":2}');
}
const o1 = { ...mk(7), x: 1 };
const o2 = { x: 1, ...mk(7) };
const o3 = { ...mk(7), m: function () { return 'm' + this.a; }, x: function () { return 'xf'; } };
const o4 = { m: 0, ...mk(7), b: 'late' };
console.log(Object.keys(o1).join(","), JSON.stringify(o1));
console.log(Object.keys(o2).join(","), JSON.stringify(o2));
console.log(Object.keys(o3).join(","), o3.x(), o3.m(), JSON.stringify(o3));
console.log(Object.keys(o4).join(","), JSON.stringify(o4));
console.log(mk(3).a, mk(3).x);
