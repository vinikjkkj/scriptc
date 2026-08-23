// A class field whose type ADMITS undefined and which no constructor
// assigns reads `undefined`, not a NULL pointer.
//
// WHY THIS PROGRAM EXISTS: the class new-function had an initializer arm
// for `jsval` fields and one for undefined-armed unions, and none for
// CHECKED-DYNAMIC ones. An `unknown`-typed field kept the calloc NULL, and
// the emitted read is `scr_dyn_retain(o->fld)` -- so the first read of it
// SEGFAULTED, on both backends, where Node answers `true` and prints
// `C { u: undefined, n: 1 }`.
//
// The same arm is what lets a class carry the run-time property table: a
// `%props` field has to read undefined before the first define mints one.
class C {
  u?: unknown
  n: number
  constructor() { this.n = 1 }
}

const c = new C()
console.log(String(c.u === undefined))
console.log(String(typeof c.u))
console.log(c)

const d = new C()
d.u = 5
console.log(String(d.u === undefined))
console.log(d)
console.log(c)
