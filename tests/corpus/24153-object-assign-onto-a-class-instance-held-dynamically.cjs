// Object.assign over an untyped target that holds a class instance writes each source key through the instance's own keyed
// write: a field takes the value, a setter runs, the target is returned.
class Box {
  constructor() { this.a = 1; this.b = "x"; this._c = 0; }
  get c() { return this._c; }
  set c(v) { this._c = v * 2; }
}
function assignTo(target, source) { return Object.assign(target, source); }
const box = new Box();
const back = assignTo(box, { a: 7, c: 5 });
console.log(back === box, box.a, box.b, box.c, box._c);
assignTo(box, { b: "y" }, undefined);
console.log(box.a, box.b, box.c);
