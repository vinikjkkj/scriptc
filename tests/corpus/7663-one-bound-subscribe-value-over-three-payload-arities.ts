// Three events with DIFFERENT payload arities -- one, two and zero -- all
// registered through a single bound subscribe value, and all fired.
//
// The runtime picks an invoke shim per entry by the LISTENER's own arity and
// hands it the event's tuple through a `va_list`, so one bound value serving
// three arities is the shape that would show a shim chosen from the wrong
// arm: a two-parameter listener under a one-argument emit reads a slot
// nothing supplied.
import { EventEmitter } from "node:events"

interface EvMap {
    readonly one: (a: number) => void
    readonly two: (a: number, b: string) => void
    readonly none: () => void
}

class ClientImpl extends EventEmitter {
    public on<K extends keyof EvMap>(event: K, listener: EvMap[K]): this
    public on(event: string, listener: (...args: unknown[]) => void): this
    public on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener)
    }
}

interface Client<TPluginEvents = {}> extends ClientImpl {
    on<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
}

const client: Client = new ClientImpl()
const on = client.on.bind(client)
on('one', (a: number): void => { console.log('one ' + String(a)) })
on('two', (a: number, b: string): void => { console.log('two ' + String(a) + ' ' + b) })
on('none', (): void => { console.log('none') })
client.emit('one', 5)
client.emit('two', 6, 'x')
client.emit('none')
console.log('done')
