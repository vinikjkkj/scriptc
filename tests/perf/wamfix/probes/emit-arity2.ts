// Same three emits as emit-arity.ts, plus ONE registration whose event name is
// not a literal. If that alone turns the emits into refusals, the cause at
// zapo-js WaClient.ts:261 is the OPAQUE REGISTRATION, not the payload.
import { EventEmitter } from 'node:events'

class Probe extends EventEmitter {
    fire(): void {
        this.emit('prim', 7)
        const a = 1
        const b = 'x'
        this.emit('literal', { a, b })
    }
}

const probe = new Probe()
const dynamicName: string = process.argv[2] ?? 'whatever'
probe.on(dynamicName, () => {
    console.log('opaque listener')
})
probe.fire()
console.log('EMIT-ARITY2: reached the end')
