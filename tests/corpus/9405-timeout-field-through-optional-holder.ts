// Two-level class holder: the outer class keeps the inner in an optional
// field, the inner keeps an array of records holding the timer handle, and
// the outer's methods call the inner's through `?.` and plain receivers.
interface Pending {
  readonly done: () => void
  readonly timer: NodeJS.Timeout
}

class Inner {
  private pending: Pending[]

  constructor() {
    this.pending = []
  }

  add(ms: number, label: string): void {
    const timer = setTimeout(() => console.log('inner timeout', label), ms)
    this.pending.push({ done: () => console.log('done', label), timer })
  }

  finishAll(): number {
    const n = this.pending.length
    for (const p of this.pending) {
      clearTimeout(p.timer)
      p.done()
    }
    this.pending = []
    return n
  }

  count(): number {
    return this.pending.length
  }
}

class Outer {
  private inner: Inner | null

  constructor() {
    this.inner = null
  }

  open(): void {
    this.inner = new Inner()
    this.inner.add(1000, 'a')
    this.inner.add(5, 'b')
  }

  finish(): number {
    return this.inner?.finishAll() ?? -1
  }

  pendingCount(): number {
    return this.inner?.count() ?? 0
  }
}

const o = new Outer()
o.open()
console.log('pending', o.pendingCount())
console.log('finished', o.finish())
console.log('pending after', o.pendingCount())
setTimeout(() => console.log('final pending', o.pendingCount()), 30)
