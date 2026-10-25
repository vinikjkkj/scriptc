import { EventEmitter } from 'node:events'
class Hub extends EventEmitter {
  fire(kind: 'a' | 'b', n: number): boolean { return this.emit(kind, n) }
}
class Other extends EventEmitter {
  fire(kind: 'a' | 'b', n: string): boolean { return this.emit(kind, n) }
}
const h = new Hub()
h.on('a', (n: number) => console.log('hub a', n))
h.on('b', (n: number) => console.log('hub b', n))
const o = new Other()
o.on('a', (s: string) => console.log('other a', s))
console.log(h.fire('a', 1), h.fire('b', 2))
console.log(o.fire('a', 'x'), o.fire('b', 'y'))
