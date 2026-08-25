// Fields first assigned outside the constructor's top level whose inferred
// type is a PLAIN object or array shape rather than bare `any` — pg's
// `this.saslSession = sasl.startSession(...)`, assigned in a method and
// cleared to null in another. The dyn box represents those faithfully; the
// refusal that used to stand here was over-broad.
function startSession(nonce) {
  return { mechanism: 'SCRAM-SHA-256', clientNonce: nonce, response: 'n,,n=*', count: 3 }
}

class Session {
  constructor() {
    this.active = false
  }

  start(nonce) {
    this.sasl = startSession(nonce)
    this.active = true
    return this.sasl.mechanism
  }

  finish() {
    this.sasl = null
    this.active = false
  }
}

const s = new Session()
console.log('before', s.sasl, s.active)
console.log('start', s.start('abc'))
console.log('read', s.sasl.mechanism, s.sasl.clientNonce, s.sasl.response, s.sasl.count)
s.finish()
console.log('after', s.sasl, s.active)

// An array field filled from an untyped parameter.
class Rows {
  constructor() {
    this.name = 'rows'
  }
  fill(v) {
    this.list = [v, v, v]
  }
}
const r = new Rows()
console.log('rows-before', r.list)
r.fill(9)
console.log('rows-after', r.list.length, r.list[0], r.list[2])

// Nested plain objects stay faithful all the way down.
class Deep {
  constructor() {
    this.tag = 'deep'
  }
  build(v) {
    this.tree = { outer: { inner: { value: v, list: [v] } } }
  }
}
const deep = new Deep()
console.log('deep-before', deep.tree)
deep.build('leaf')
console.log('deep-after', deep.tree.outer.inner.value, deep.tree.outer.inner.list[0])

// Inheritance: the derived field is undefined until its branch runs, and the
// base's own conditional field behaves the same through the subclass.
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
    if (extra) this.w = extra
  }
}
const plain = new Derived(false, null)
console.log('derived-skipped', plain.x, plain.y, plain.z, plain.w)
const full = new Derived(true, 'e')
console.log('derived-taken', full.x, full.y, full.z, full.w)

// A field assigned by a method the constructor itself calls.
class Init {
  constructor() {
    this.a = 1
    this.setup()
  }
  setup() {
    this.b = 'from-setup'
  }
}
console.log('init', new Init().a, new Init().b)
