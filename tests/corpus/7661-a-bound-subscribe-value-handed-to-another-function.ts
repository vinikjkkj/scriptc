// The bound subscribe value passed to another function and called THERE.
//
// The dispatcher is an ordinary closure once it exists, so the interesting
// part is that its type survives the parameter: `wire` takes `typeof f`, the
// bind expression's own type, and registers through it. Node registers the
// listener the same way; both fire it.
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
const f = client.on.bind(client)

function wire(sub: typeof f): void {
    sub('ready', (info: { readonly id: number }): void => {
        console.log('wired ready ' + String(info.id))
    })
}
wire(f)
client.emit('ready', { id: 11 })
console.log('done')
