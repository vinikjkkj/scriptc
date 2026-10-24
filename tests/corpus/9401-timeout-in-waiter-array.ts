// An array of records carrying the Node timer handle, held by a class and
// drained by its methods: the ConnectionWaiter[] shape (zapo-js WaComms).
interface Waiter {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

class Comms {
  private waiters: Waiter[]
  private started: boolean

  constructor() {
    this.waiters = []
    this.started = false
  }

  start(): void {
    this.started = true
  }

  waitFor(ms: number, label: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('waiter ' + label + ' timed out'))
      }, ms)
      this.waiters.push({ resolve: () => resolve(), reject: (e) => reject(e), timer })
    })
  }

  fire(): number {
    let n = 0
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()
      if (w === undefined) break
      clearTimeout(w.timer)
      w.resolve()
      n++
    }
    return n
  }

  stop(): void {
    this.started = false
    console.log('stopped with', this.waiters.length, 'waiters')
  }
}

async function main(): Promise<void> {
  const c = new Comms()
  c.start()
  const w1 = c.waitFor(1000, 'one')
  const w2 = c.waitFor(5, 'two')
  w2.catch((e) => console.log(e instanceof Error ? e.message : e))
  console.log('fired', c.fire())
  await w1
  console.log('w1 resolved')
  const w3 = c.waitFor(5, 'three')
  w3.catch((e) => console.log(e instanceof Error ? e.message : e))
  await new Promise<void>((r) => setTimeout(r, 40))
  c.stop()
}

main()
