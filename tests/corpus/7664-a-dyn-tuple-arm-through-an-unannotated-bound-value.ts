// A DYN tuple position reached through a bound value with no contextual type
// -- corpus 7595's shape, one spelling further out.
//
// `decode_error`'s payload is re-emitted from an UNTYPED emitter's callback
// parameters; those are `any`, `any` maps nowhere without --dynamic, and the
// program-global table records DYN for the position. The arm owes such an
// event a BOXED registration through `emitter.onDyn`, where the dyn box is
// the entry's IDENTITY -- which is why `off` through the same bound value
// still finds it, and why the count goes back to zero.
import { EventEmitter } from "node:events"

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

const client: Client = new ClientImpl()
const transport = new Transport()
transport.on('raw', (node, frame) => {
    client.emit('decode_error', { node, frame })
})

const on = client.on.bind(client)
const off = client.off.bind(client)

const onDecode = (detail: { readonly node: unknown; readonly frame: unknown }): void => {
    console.log('decode node=' + String(detail.node) + ' frame=' + String(detail.frame))
}
on('ready', (info: { readonly id: number }): void => { console.log('ready ' + String(info.id)) })
on('decode_error', onDecode)
client.emit('ready', { id: 3 })
transport.emit('raw', 'N1', 'F1')
console.log('count ' + String(client.listenerCount('decode_error')))
off('decode_error', onDecode)
transport.emit('raw', 'N2', 'F2')
console.log('count after off ' + String(client.listenerCount('decode_error')))
console.log('done')
