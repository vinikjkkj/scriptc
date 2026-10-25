import { EventEmitter } from 'node:events'
class Conn extends EventEmitter {
  close(): void { this.emit('end') }
}
class Query extends EventEmitter {
  run(rows: number[]): void { this.emit('end', rows) }
}
const c = new Conn()
const q = new Query()
c.once('end', () => console.log('conn end'))
q.once('end', (rows: number[]) => console.log('query end', rows.length))
c.close()
q.run([1, 2, 3])
