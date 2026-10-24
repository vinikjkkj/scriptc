// A record whose member is the Node timer handle, stored in a Map on a
// class: the PendingNodeQuery shape (zapo-js WaNodeOrchestrator). The
// member type is `NodeJS.Timeout`, which must resolve to the timer handle.
interface Pending {
  readonly resolve: (value: number) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

class Orchestrator {
  private readonly pending: Map<string, Pending>

  constructor() {
    this.pending = new Map()
  }

  query(id: string, ms: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('timeout ' + id))
      }, ms)
      this.pending.set(id, { resolve: (v) => resolve(v), reject: (e) => reject(e), timer })
    })
  }

  settle(id: string, value: number): boolean {
    const p = this.pending.get(id)
    if (p === undefined) return false
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.resolve(value)
    return true
  }

  get size(): number {
    return this.pending.size
  }
}

async function main(): Promise<void> {
  const o = new Orchestrator()
  const a = o.query('a', 1000)
  console.log('settle a', o.settle('a', 7), o.size)
  console.log('a =', await a)
  console.log('settle missing', o.settle('nope', 1))
  const b = o.query('b', 5)
  b.catch((e) => console.log('b failed:', e instanceof Error ? e.message : e))
  await new Promise<void>((r) => setTimeout(r, 40))
  console.log('size after timeout', o.size)
}

main()
