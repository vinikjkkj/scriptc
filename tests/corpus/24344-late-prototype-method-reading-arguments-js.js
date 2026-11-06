// A function expression assigned to an undeclared prototype member that reads `arguments`:
// length, indexing, sloppy aliasing of named parameters and `.apply(this, arguments)` forwarding.
class Pipeline {
  constructor() { this.count = 0; }
}
function base(a, b) { this.count += 1; return [a, b, arguments.length]; }
// @ts-expect-error
Pipeline.prototype.multi = function () {
  this.count += 1;
  return base.apply(this, arguments);
};
// @ts-expect-error
Pipeline.prototype.count3 = function (a, b) {
  const n = arguments.length;
  arguments[0] = "changed";
  return [n, a, b, arguments[1]];
};
const p = new Pipeline();
console.log(JSON.stringify(p.multi()));
console.log(JSON.stringify(p.multi(1)));
console.log(JSON.stringify(p.multi(1, 2, 3)));
console.log(JSON.stringify(p.count3()));
console.log(JSON.stringify(p.count3("x", "y", "z")));
console.log(p.count);
