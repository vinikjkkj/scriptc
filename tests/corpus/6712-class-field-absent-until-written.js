// A JS class field first assigned OUTSIDE the constructor's top level does
// not EXIST on the instance until its write runs. The static layout has
// the cell from construction, so every enumeration surface has to read the
// slot's undefined arm as absence — `util.inspect` printed
// `C { a: 1, b: undefined }` where Node prints `C { a: 1 }`, at exit 0,
// with no diagnostic anywhere.
class C {
  constructor(flag) {
    this.a = 1
    if (flag) this.b = 2
  }
}
console.log(new C(false))
console.log(new C(true))

// Through a container, and at depth: the entry is skipped wherever the
// instance renders, not only at the top level.
console.log([new C(false), new C(true)])
console.log({ wrapped: new C(false) })

// Assigned in a METHOD rather than a constructor branch — the same slot,
// reached later.
class Late {
  constructor(name) {
    this.name = name
  }
  arm() {
    this.count = 3
  }
}
const late = new Late('l')
console.log(late)
late.arm()
console.log(late)

// EVERY visible slot absent: "is it empty" becomes a run-time question,
// and Node prints `C {}` for a keyless object however deep it is.
class AllLate {
  constructor(flag) {
    if (flag) this.x = 'x'
    if (flag) this.y = 'y'
  }
}
console.log(new AllLate(false))
console.log(new AllLate(true))
console.log({ deep: { deeper: { deepest: new AllLate(false) } } })

// A string slot and a boolean slot, so the arm test is not a number
// accident.
class Mixed {
  constructor(flag) {
    this.tag = 'm'
    if (flag) this.s = 'str'
    if (flag) this.t = true
  }
}
console.log(new Mixed(false))
console.log(new Mixed(true))

// INHERITED: the base's absent slot stays absent through the subclass, and
// the subclass's own slot is independent.
class Base {
  constructor(flag) {
    this.x = 1
    if (flag) this.y = 2
  }
}
class Derived extends Base {
  constructor(flag, extra) {
    super(flag)
    this.z = 3
    if (extra) this.w = 'extra'
  }
}
console.log(new Derived(false, 0))
console.log(new Derived(true, 0))
console.log(new Derived(false, 9))
console.log(new Derived(true, 9))

// The slot still holds Node's `undefined` as a VALUE — skipping the inspect
// entry must not change what a read answers.
const skipped = new C(false)
console.log('read', skipped.b, typeof skipped.b)

// A write of `undefined` from OUTSIDE the class makes the property real in
// Node — `Escaped { a: 1, e: undefined }`, not `Escaped { a: 1 }` — so the
// entry has to stay. That write is what disqualifies the NAME `e` from
// absence-tracking across the whole program, which is why the round trip
// below still prints the arm while every slot above it is skipped.
//
// The disqualifier is keyed on the NAME, not the receiver, and that
// over-approximates on purpose: a class whose OWN `e` is never written
// undefined loses the skip because some other line in the program writes
// one. Costing a class an entry it could have skipped is exactly the
// behaviour that stood before, while a receiver-precise rule that missed
// one write would print nothing where Node prints a property.
class Escaped {
  constructor(flag) {
    this.a = 1
    if (flag) this.e = 2
  }
}
const esc = new Escaped(true)
console.log(esc)
esc.e = undefined
console.log(esc)
