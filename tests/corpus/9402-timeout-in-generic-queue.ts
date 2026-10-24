// A generic class keeping a Map of retry entries that carry the Node timer
// handle, with a holder class calling its methods through a field: the
// BackgroundQueue / WriteBehindPersistence shape.
interface RetryEntry<V> {
  readonly value: V
  readonly timer: NodeJS.Timeout
}

class Queue<K extends string, V> {
  private readonly retries: Map<K, RetryEntry<V>>
  private restarts: number

  constructor() {
    this.retries = new Map()
    this.restarts = 0
  }

  schedule(key: K, value: V, ms: number, onFire: (key: K, value: V) => void): void {
    const timer = setTimeout(() => {
      this.retries.delete(key)
      onFire(key, value)
    }, ms)
    this.retries.set(key, { value, timer })
  }

  cancel(key: K): boolean {
    const entry = this.retries.get(key)
    if (entry === undefined) return false
    clearTimeout(entry.timer)
    this.retries.delete(key)
    return true
  }

  restart(): void {
    this.restarts++
    for (const entry of this.retries.values()) clearTimeout(entry.timer)
    this.retries.clear()
  }

  get pending(): number {
    return this.retries.size
  }

  get restartCount(): number {
    return this.restarts
  }
}

class Persistence {
  private readonly queue: Queue<string, number>

  constructor() {
    this.queue = new Queue<string, number>()
  }

  run(): void {
    this.queue.schedule('a', 1, 5, (k, v) => console.log('fired', k, v))
    this.queue.schedule('b', 2, 1000, (k, v) => console.log('never', k, v))
    console.log('cancel b', this.queue.cancel('b'), this.queue.pending)
    this.queue.restart()
    console.log('restarts', this.queue.restartCount, 'pending', this.queue.pending)
    this.queue.schedule('c', 3, 5, (k, v) => console.log('fired', k, v))
  }

  close(): void {
    this.queue.restart()
    console.log('closed, pending', this.queue.pending)
  }
}

const p = new Persistence()
p.run()
setTimeout(() => p.close(), 40)
