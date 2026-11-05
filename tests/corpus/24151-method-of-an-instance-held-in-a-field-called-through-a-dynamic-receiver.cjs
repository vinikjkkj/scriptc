// A method that is only ever called through an untyped receiver (`o.q.count()` where `o` is a parameter nobody typed)
// must exist in the member table of the instance held in the field `q`, whether that instance is held directly, in an
// array, or through a base-typed field that holds a subclass.
class Q { constructor() { this.n = 3; } count() { return this.n; } cnt2() { return arguments.length; } cnt3(a) { return arguments.length + a; } }
class R extends Q { count() { return this.n * 10; } extra() { return "extra"; } }
class C { constructor() { this.q = new Q(); this.list = [new Q(), new R()]; this.base = new R(); } }
const c = new C();
function viaDyn(o) {
  return [o.q.count(), o.q.cnt2(), o.q.cnt2(1, 2), o.q.cnt3(5, 6), o.list[0].count(), o.list[1].count(), o.list[1].extra(), o.base.count(), o.base.extra()].join(",");
}
console.log(viaDyn(c));
