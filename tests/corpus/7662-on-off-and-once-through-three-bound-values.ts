// `on`, `off` and `once` through three bound values with no contextual type,
// against ONE receiver -- and the identity question that makes `off` real.
//
// A handler registered through the bound `on` must be removable through the
// bound `off`, and a handler registered DIRECTLY must be removable directly,
// with both live on the same event at once. It holds for a structural reason
// rather than a lucky one: every arm narrows the SAME closure out of the
// union (a union payload is the closure pointer, not a copy) and the runtime
// matches listeners by pointer identity.
//
// `listenerCount` and the firing ORDER are printed across both registration
// paths, before and after each removal, because a dispatcher that registered
// into a second bucket would still print plausible lines for the fires.
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
    public once<K extends keyof EvMap>(event: K, listener: EvMap[K]): this
    public once(event: string, listener: (...args: unknown[]) => void): this
    public once(event: string, listener: (...args: unknown[]) => void): this {
        return super.once(event, listener)
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
    once<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
    off<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
    emit<K extends keyof (EvMap & TPluginEvents)>(
        event: K,
        payload: Parameters<Extract<(EvMap & TPluginEvents)[K], (...args: never[]) => unknown>>[0]
    ): boolean
}

const client: Client = new ClientImpl()
const on = client.on.bind(client)
const off = client.off.bind(client)
const once = client.once.bind(client)

const h = (info: { readonly id: number }): void => { console.log('h ' + String(info.id)) }
const direct = (info: { readonly id: number }): void => { console.log('direct ' + String(info.id)) }

on('ready', h)
client.on('ready', direct)
once('ready', (info: { readonly id: number }): void => { console.log('once ' + String(info.id)) })
console.log('count ' + String(client.listenerCount('ready')))
client.emit('ready', { id: 1 })
console.log('count after ' + String(client.listenerCount('ready')))
off('ready', h)
client.off('ready', direct)
console.log('count off ' + String(client.listenerCount('ready')))
client.emit('ready', { id: 2 })
console.log('done')
