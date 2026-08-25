// A JS class field read INSIDE the constructor at a point before the
// assignment that declares it. In Node the property does not exist yet and
// the read answers `undefined`; the static layout's slot exists from calloc,
// so without the undefined arm the read answered the zero of its type — `0`
// for a number, `false` for a boolean, an empty string. That is the
// zeroed-memory answer the whole field scan exists to avoid, firing inside
// the SUPPORTED form.
class Numbers {
  constructor() {
    this.a = 1
    console.log('n-before', this.b)
    this.b = 2
    console.log('n-after', this.b)
  }
}
new Numbers()

class Strings {
  constructor() {
    console.log('s-before', this.name)
    this.name = 'set'
    console.log('s-after', this.name)
  }
}
new Strings()

class Booleans {
  constructor() {
    console.log('b-before', this.ready)
    this.ready = true
    console.log('b-after', this.ready)
  }
}
new Booleans()

// A compound assignment is a read AND a write; the read still precedes the
// declaration, so it sees undefined and NaN comes out, exactly like Node.
class Compound {
  constructor() {
    this.total = 0
    this.total += 5
    console.log('compound', this.total)
  }
}
new Compound()

// The read is inside a nested expression, not a bare statement.
class Nested {
  constructor(flag) {
    this.tag = flag ? String(this.other) : 'plain'
    this.other = 'later'
  }
}
console.log('nested-true', new Nested(true).tag, new Nested(true).other)
console.log('nested-false', new Nested(false).tag)

// A read AFTER the declaring assignment is an ordinary read and must not be
// widened into anything — it answers the value, and arithmetic on it works.
class AfterOnly {
  constructor() {
    this.n = 7
    console.log('after-only', this.n + 1)
  }
}
new AfterOnly()

// Two fields, each read before its own declaration but after the other's.
class Pair {
  constructor() {
    console.log('pair-1', this.x, this.y)
    this.x = 10
    console.log('pair-2', this.x, this.y)
    this.y = 20
    console.log('pair-3', this.x, this.y)
  }
}
new Pair()
