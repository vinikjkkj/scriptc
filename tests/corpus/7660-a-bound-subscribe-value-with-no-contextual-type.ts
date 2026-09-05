// `const f = c.on.bind(c)` -- a bound subscribe member in a LOCAL, with NO
// destination naming its shape, then called.
//
// This is the spelling the bound-subscribe dispatcher could not answer. It
// read the slot off the CONTEXTUAL type, which is exactly what a plugin-
// context literal supplies and what a plain binding does not, so the member
// kept the EventEmitter-as-a-VALUE fence.
//
// The bind expression's OWN type is the answer, and on this shape it is the
// stronger one: `strict` implies `strictBindCallApply`, so `bind` resolves
// through `CallableFunction.bind` and carries the member's own signature with
// `this` fixed -- the very declaration the key set is read from -- and it is
// the type the rest of the program computes for the binding, so the closure
// the dispatcher builds and every later use of it agree by construction. A
// contextual type is only required to be a SUPERTYPE of the value.
import { EventEmitter } from "node:events"

interface EvMap {
    readonly ready: (info: { readonly id: number }) => void
    readonly closed: (info: { readonly why: string }) => void
}

class ClientImpl extends EventEmitter {
    public on<K extends keyof EvMap>(event: K, listener: EvMap[K]): this
    public on(event: string, listener: (...args: unknown[]) => void): this
    public on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener)
    }
    public emit<K extends keyof EvMap>(event: K, payload: Parameters<EvMap[K]>[0]): boolean
    public emit(event: string, ...args: unknown[]): boolean
    public emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args)
    }
}

interface Client<TPluginEvents = {}> extends ClientImpl {
    on<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
    emit<K extends keyof (EvMap & TPluginEvents)>(
        event: K,
        payload: Parameters<Extract<(EvMap & TPluginEvents)[K], (...args: never[]) => unknown>>[0]
    ): boolean
}

const client: Client = new ClientImpl()

// The literal blocker: a bound member in a LOCAL with no contextual type.
const f = client.on.bind(client)

f('ready', (info: { readonly id: number }): void => {
    console.log('ready ' + String(info.id))
})
f('closed', (info: { readonly why: string }): void => {
    console.log('closed ' + info.why)
})

client.emit('ready', { id: 7 })
client.emit('closed', { why: 'bye' })
console.log('done')
