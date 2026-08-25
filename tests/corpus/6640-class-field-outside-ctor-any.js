// A JS class field first assigned OUTSIDE the constructor's top level, whose
// inferred type is implicit `any` — the shape every npm package with an
// untyped callback parameter has (`this._connectionCallback = callback`).
// Reads before the assignment must answer Node's `undefined`, not a zeroed
// slot and not a refusal.
class Client {
  constructor(config) {
    this.user = (config && config.user) || 'anon'
    this._connecting = false
  }

  connect(callback) {
    if (callback) {
      this._connectionCallback = callback
      return
    }
    return 'promise'
  }

  authenticate() {
    this.password = 'secret'
    return this.password
  }
}

const c = new Client({ user: 'u' })
console.log('user', c.user, 'connecting', c._connecting)
console.log('cb-before', c._connectionCallback)
console.log('pw-before', c.password)
console.log('no-callback', c.connect(null))
c.connect(function () {
  return 42
})
console.log('cb-after', typeof c._connectionCallback, c._connectionCallback())
console.log('auth', c.authenticate(), 'pw-after', c.password)

// The same field on a SECOND instance is independent and starts undefined.
const d = new Client(null)
console.log('second', d.user, d._connectionCallback, d.password)

// Assigned only in a branch the run does not take.
class Cond {
  constructor(flag, value) {
    this.a = 1
    if (flag) this.v = value
  }
}
console.log('skipped', new Cond(false, 7).v)
console.log('taken', new Cond(true, 7).v)
console.log('taken-str', new Cond(true, 'str').v)

// Assigned only inside a loop that may run zero times.
class Loop {
  constructor(items) {
    this.count = 0
    for (const item of items) {
      this.last = item
      this.count++
    }
  }
}
const empty = new Loop([])
console.log('loop-zero', empty.last, empty.count)
const filled = new Loop([1, 2, 3])
console.log('loop-three', filled.last, filled.count)

// Assigned only in a catch arm.
class Guarded {
  constructor(explode) {
    this.ok = false
    try {
      if (explode) throw new Error('boom')
      this.ok = true
    } catch (e) {
      this.err = e.message
    }
  }
}
const fine = new Guarded(false)
console.log('no-throw', fine.ok, fine.err)
const blown = new Guarded(true)
console.log('threw', blown.ok, blown.err)

// A field whose only assignment is `null` infers `any` in checkJs.
class Nullable {
  constructor(flag) {
    this.a = 1
    if (flag) this.n = null
  }
}
console.log('null-skipped', new Nullable(false).n)
console.log('null-taken', new Nullable(true).n)
