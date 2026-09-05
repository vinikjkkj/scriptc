// The event name computed at RUN TIME, passed to a bound subscribe value.
//
// The dispatcher's whole shape is a `strEq` chain, so a name that is not a
// literal at the call site is the ordinary case rather than the exceptional
// one -- but it is the case a per-event monomorphization cannot serve
// directly, and the reason the member alone has no value.
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
const names: string[] = ['ready', 'closed']
const pick = names[Number(process.argv.length > 99) ] as 'ready'
on(pick, (info: { readonly id: number }): void => { console.log('runtime-name ' + String(info.id)) })
client.emit('ready', { id: 42 })
console.log('done')
