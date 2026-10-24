// The 9400 shape in plain JavaScript: the same record of a timer handle in
// a Map on a class, with no type annotations. Control for the JS path.
class Orchestrator {
  constructor() {
    this.pending = new Map()
  }

  query(id, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('timeout ' + id))
      }, ms)
      this.pending.set(id, { resolve: (v) => resolve(v), reject: (e) => reject(e), timer })
    })
  }

  settle(id, value) {
    const p = this.pending.get(id)
    if (p === undefined) return false
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.resolve(value)
    return true
  }

  get size() {
    return this.pending.size
  }
}

async function main() {
  const o = new Orchestrator()
  const a = o.query('a', 1000)
  console.log('settle a', o.settle('a', 7), o.size)
  console.log('a =', await a)
  const b = o.query('b', 5)
  b.catch((e) => console.log('b failed:', e.message))
  await new Promise((r) => setTimeout(r, 40))
  console.log('size after timeout', o.size)
}

main()
