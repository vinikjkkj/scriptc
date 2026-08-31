// The hypothesis the compiler's own comment states: a listener that IGNORES
// the payload pins the event's tuple to ZERO, and the emit site that supplies
// one payload then refuses.
import { EventEmitter } from 'node:events'

class Probe extends EventEmitter {
    fire(): void {
        const a = 1
        const b = 'x'
        this.emit('literal', { a, b })
    }
}

const probe = new Probe()
let n = 0
probe.on('literal', () => {
    n += 1
})
probe.fire()
console.log('EMIT-ARITY3: n=' + String(n))
