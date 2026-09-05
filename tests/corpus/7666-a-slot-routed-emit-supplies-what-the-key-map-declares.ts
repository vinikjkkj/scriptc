// The last refusal in zapo's `installWaClientPlugins`, reduced: an event whose
// key map declares a payload, whose only DIRECT listener ignores it, and whose
// only emit is routed through a bound-emit SLOT.
//
// The program-global event table is unified from the `.emit(` and `.on(` sites
// the syntactic scan can see. A call on a function-typed FIELD is not one of
// them, so `paired`'s tuple sits at ZERO -- the longest direct listener -- and
// the emit dispatcher, reading the table as the truth, TRUNCATED its arm to
// zero arguments. The subscribe dispatcher then had to refuse `paired`: its
// arm would register the key map's declared one-parameter handler, and the
// runtime picks each entry's invoke shim by the listener's own arity, so a
// one-parameter shim over a zero-argument emit reads a slot nothing supplied.
// One refused key fences the WHOLE dispatcher, over an event no plugin even
// listens to.
//
// Neither half was wrong on its own; they disagreed about what an emit
// supplies. Both now take the same rule: with no emit anywhere pinning the
// arity, the event's tuple is the receiver CLASS's own declaration, extended
// past whatever prefix the direct listeners reached. The emit arm supplies it
// and the subscribe arm may register against it -- and the direct
// zero-parameter listener is a prefix, which is what the emitter promises
// everywhere else.
import { EventEmitter } from "node:events"

interface EvMap {
    readonly ready: (info: { readonly id: number }) => void
    // Declared with ONE parameter. The only DIRECT listener takes NONE, and
    // the only emit is routed through a bound-emit SLOT, which the syntactic
    // event scan cannot see. So the program-global tuple is ZERO.
    readonly paired: (info: { readonly who: string }) => void
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

interface Runtime {
    readonly emitEvent: <K extends keyof EvMap>(event: K, ...args: Parameters<EvMap[K]>) => void
}
interface Ctx {
    readonly on: Client['on']
}

const client: Client = new ClientImpl()
const runtime: Runtime = { emitEvent: client.emit.bind(client) as unknown as Runtime['emitEvent'] }

client.on('paired', () => { console.log('paired (consumer, no payload)') })
client.on('ready', (info: { readonly id: number }): void => { console.log('ready ' + String(info.id)) })

const ctx: Ctx = { on: client.on.bind(client) }
ctx.on('paired', (info: { readonly who: string }): void => { console.log('plugin paired ' + info.who) })

runtime.emitEvent('ready', { id: 1 })
runtime.emitEvent('paired', { who: 'alice' })
console.log('done')
