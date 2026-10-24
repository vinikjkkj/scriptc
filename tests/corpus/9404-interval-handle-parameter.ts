// A `NodeJS.Timeout` handle passed as a parameter, stored in a record that
// lives in a Map, and cleared later: a setInterval handle carried through a
// record member and read back by a method (the keepalive / timer-table shape).
interface Ticker {
  readonly name: string
  readonly handle: NodeJS.Timeout
  ticks: number
}

class Scheduler {
  private readonly tickers: Map<string, Ticker>

  constructor() {
    this.tickers = new Map()
  }

  start(name: string, ms: number, limit: number): void {
    const ticker: Ticker = { name, handle: setInterval(() => this.tick(name, limit), ms), ticks: 0 }
    this.tickers.set(name, ticker)
  }

  private tick(name: string, limit: number): void {
    const t = this.tickers.get(name)
    if (t === undefined) return
    t.ticks++
    console.log(name, 'tick', t.ticks)
    if (t.ticks >= limit) this.stop(name)
  }

  stop(name: string): void {
    const t = this.tickers.get(name)
    if (t === undefined) return
    clearInterval(t.handle)
    this.tickers.delete(name)
    console.log('stopped', name, 'after', t.ticks)
  }

  active(): number {
    return this.tickers.size
  }
}

function describe(handle: NodeJS.Timeout, label: string): string {
  return label + ':' + (handle === handle ? 'same' : 'diff')
}

const s = new Scheduler()
s.start('fast', 3, 3)
s.start('slow', 1000, 1)
console.log('active', s.active())
setTimeout(() => {
  console.log('active later', s.active())
  s.stop('slow')
}, 60)
