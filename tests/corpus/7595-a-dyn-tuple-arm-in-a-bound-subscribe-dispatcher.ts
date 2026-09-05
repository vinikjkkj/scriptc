// A DYN tuple position in a bound-SUBSCRIBE dispatcher -- corpus 7384's shape,
// on the other side of the slot.
//
// `decode_error`'s payload is re-emitted from an UNTYPED emitter's callback
// parameters. Those are `any`, `any` maps nowhere without --dynamic, and the
// program-global table therefore records DYN for the position -- an event
// NOTHING in the program typed. 7384 gave the emit dispatcher the arm it owes
// such an event: a BOXED payload, because the tuple is dyn precisely when the
// bucket holds dyn adapters.
//
// The subscribe dispatcher owes it the mirror. The runtime picks an invoke
// shim per entry by the LISTENER's own arity and hands it the tuple through a
// va_list, so registering a `(record) => void` against a dyn-tupled event
// would read the emitted dyn AS the record: a wrong memory read, and not a
// diagnostic. The arm instead registers through the same `emitter.onDyn` path
// a directly written checked-dynamic listener takes -- the dyn box is the
// entry's IDENTITY, so `off` through the slot still finds it, and the dynCheck
// adapter is what emit invokes.
//
// This is the arm zapo needs. Without it ONE untyped event took the whole
// plugin-context slot down, and `installWaClientPlugins` stayed on the
// member-as-a-VALUE fence -- the same all-or-nothing coupling 7384 unpicked
// for emit, reached from the other end.
import { EventEmitter } from "node:events"

/** No key map, so its listener parameters are `any`. */
class Transport extends EventEmitter {}

interface EvMap {
    readonly ready: (info: { readonly id: number }) => void
    readonly decode_error: (detail: { readonly node: unknown; readonly frame: unknown }) => void
}

class ClientImpl extends EventEmitter {
    public on<K extends keyof EvMap>(event: K, listener: EvMap[K]): this
    public on(event: string, listener: (...args: unknown[]) => void): this
    public on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener)
    }
    public off<K extends keyof EvMap>(event: K, listener: EvMap[K]): this
    public off(event: string, listener: (...args: unknown[]) => void): this
    public off(event: string, listener: (...args: unknown[]) => void): this {
        return super.off(event, listener)
    }
    public emit<K extends keyof EvMap>(event: K, payload: Parameters<EvMap[K]>[0]): boolean
    public emit(event: string, ...args: unknown[]): boolean
    public emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args)
    }
}

interface Client<TPluginEvents = {}> extends ClientImpl {
    on<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
    off<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
    emit<K extends keyof (EvMap & TPluginEvents)>(
        event: K,
        payload: Parameters<Extract<(EvMap & TPluginEvents)[K], (...args: never[]) => unknown>>[0]
    ): boolean
}

interface Ctx {
    readonly on: Client['on']
    readonly off: Client['off']
}

const client: Client = new ClientImpl()
const transport = new Transport()
// The re-emit that gives `decode_error` its dyn tuple: `node` and `frame`
// arrive as `any` from an untyped emitter's callback.
transport.on('raw', (node, frame) => {
    client.emit('decode_error', { node, frame })
})

const ctx: Ctx = { on: client.on.bind(client), off: client.off.bind(client) }

const onDecode = (detail: { readonly node: unknown; readonly frame: unknown }): void => {
    console.log('decode_error node=' + String(detail.node) + ' frame=' + String(detail.frame))
}
ctx.on('ready', (info: { readonly id: number }): void => {
    console.log('ready ' + String(info.id))
})
ctx.on('decode_error', onDecode)

client.emit('ready', { id: 3 })
transport.emit('raw', 'N1', 'F1')
console.log('decode listeners ' + String(client.listenerCount('decode_error')))
ctx.off('decode_error', onDecode)
transport.emit('raw', 'N2', 'F2')
console.log('decode listeners after off ' + String(client.listenerCount('decode_error')))
console.log('done')
