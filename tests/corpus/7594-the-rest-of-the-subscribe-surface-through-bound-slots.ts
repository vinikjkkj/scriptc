// The rest of the subscribe surface bound into slots: `addListener`,
// `prependListener`, `prependOnceListener` and `removeListener`.
//
// `boundSubscribeDispatcher` claims seven spellings, and each carries its own
// (registering, once, prepend) triple straight through to the runtime, exactly
// as the direct path does. ORDER is the only thing prepend changes and the
// only thing a mis-set flag would show, so order is what this program reads:
// the prepend-once listener fires first and only once, the prepended listener
// stays ahead of the added one, and `removeListener` through the slot finds
// the registration `addListener` through the slot made.
//
// It also pins that the four spellings do NOT share a lifted body. `on` and
// `once` wear the same erased slot type, and so do `addListener` and
// `prependListener`; the member name is part of the interning identity for
// that reason.
import { EventEmitter } from "node:events"

interface EvMap {
    readonly tick: (e: { readonly n: number }) => void
}

class ClientImpl extends EventEmitter {
    public addListener<K extends keyof EvMap>(event: K, listener: EvMap[K]): this
    public addListener(event: string, listener: (...args: unknown[]) => void): this
    public addListener(event: string, listener: (...args: unknown[]) => void): this {
        return super.addListener(event, listener)
    }
    public prependListener<K extends keyof EvMap>(event: K, listener: EvMap[K]): this
    public prependListener(event: string, listener: (...args: unknown[]) => void): this
    public prependListener(event: string, listener: (...args: unknown[]) => void): this {
        return super.prependListener(event, listener)
    }
    public prependOnceListener<K extends keyof EvMap>(event: K, listener: EvMap[K]): this
    public prependOnceListener(event: string, listener: (...args: unknown[]) => void): this
    public prependOnceListener(event: string, listener: (...args: unknown[]) => void): this {
        return super.prependOnceListener(event, listener)
    }
    public removeListener<K extends keyof EvMap>(event: K, listener: EvMap[K]): this
    public removeListener(event: string, listener: (...args: unknown[]) => void): this
    public removeListener(event: string, listener: (...args: unknown[]) => void): this {
        return super.removeListener(event, listener)
    }
    public emit<K extends keyof EvMap>(event: K, payload: Parameters<EvMap[K]>[0]): boolean
    public emit(event: string, ...args: unknown[]): boolean
    public emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args)
    }
}

interface Client<TPluginEvents = {}> extends ClientImpl {
    addListener<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
    prependListener<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
    prependOnceListener<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
    removeListener<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this
    emit<K extends keyof (EvMap & TPluginEvents)>(
        event: K,
        payload: Parameters<Extract<(EvMap & TPluginEvents)[K], (...args: never[]) => unknown>>[0]
    ): boolean
}

interface Ctx {
    readonly add: Client['addListener']
    readonly pre: Client['prependListener']
    readonly preOnce: Client['prependOnceListener']
    readonly rm: Client['removeListener']
}

const client: Client = new ClientImpl()
const ctx: Ctx = {
    add: client.addListener.bind(client),
    pre: client.prependListener.bind(client),
    preOnce: client.prependOnceListener.bind(client),
    rm: client.removeListener.bind(client)
}

const second = (e: { readonly n: number }): void => {
    console.log('second ' + String(e.n))
}
ctx.add('tick', second)
ctx.pre('tick', (e: { readonly n: number }): void => {
    console.log('first ' + String(e.n))
})
ctx.preOnce('tick', (e: { readonly n: number }): void => {
    console.log('zeroth-once ' + String(e.n))
})

client.emit('tick', { n: 1 })
console.log('--')
client.emit('tick', { n: 2 })
ctx.rm('tick', second)
console.log('--')
client.emit('tick', { n: 3 })
console.log('tick listeners ' + String(client.listenerCount('tick')))
console.log('done')
