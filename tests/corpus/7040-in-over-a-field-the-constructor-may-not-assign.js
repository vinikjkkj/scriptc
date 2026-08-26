// `'b' in c` used to answer the LAYOUT rather than the object.
//
// A field first assigned in a conditional constructor position, or in a
// method, collects into an undefined-armed slot precisely because it does
// not exist until the write runs. The static layout has a slot for it from
// calloc onward, so the literal-key `in` fold answered the constant `true`
// for an instance whose constructor never took that branch. Node answers
// `false`: the property is not there.
//
// The answer now is the one the RECORD path already gives an optional slot
// -- the undefined arm reads absent -- so a class field and a record field
// say the same thing about the same value.
class Conditional {
  constructor(f) {
    if (f) {
      this.b = 1
    }
    this.a = 0
  }
}

const withB = new Conditional(true)
const withoutB = new Conditional(false)
console.log('taken', 'b' in withB, withB.b)
console.log('skipped', 'b' in withoutB, withoutB.b)
console.log('always', 'a' in withB, 'a' in withoutB)

// The same question about a field only a METHOD ever writes.
class Later {
  arm(v) {
    this.late = v
  }
}

const l = new Later()
console.log('before', 'late' in l, l.late)
l.arm(7)
console.log('after', 'late' in l, l.late)

// A name the class does not declare at all, and one it inherits from
// Object.prototype: neither is affected by the arm test.
console.log('absent', 'nope' in l, 'proto', 'toString' in l)
