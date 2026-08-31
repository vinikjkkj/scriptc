// Reproduces the shape of zapo-js WaClient.ts:261 in ten lines, to find out
// WHY 'emit(...) with 1 arguments where the event's tuple has 0' fires there.
// Three events, no listener registered for any of them, each emitted once.
import { EventEmitter } from 'node:events'

interface Payload {
    readonly a: number
    readonly b: string
}

class Probe extends EventEmitter {
    fire(): void {
        // 1. an inert primitive argument
        this.emit('prim', 7)
        // 2. an identifier read
        const p: Payload = { a: 1, b: 'x' }
        this.emit('ident', p)
        // 3. a FRESH OBJECT LITERAL -- what WaClient.ts:261 passes
        const a = 1
        const b = 'x'
        this.emit('literal', { a, b })
    }
}

const probe = new Probe()
probe.fire()
console.log('EMIT-ARITY: reached the end')
