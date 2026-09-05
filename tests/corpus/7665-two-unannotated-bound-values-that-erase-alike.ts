// Two bound subscribe values whose slots ERASE ALIKE over DIFFERENT key sets,
// neither with a contextual type -- corpus 7593's hazard reached through the
// bind expression's own type.
//
// `<K extends keyof MapA>` and `<K extends keyof MapB>` both become
// `(string, (record) => void) => this` once the constraint is instantiated
// and the handler union collapses to its one arm. If the narrow slot's body
// were reused for the wide one, `c`'s registration would be SILENTLY DROPPED:
// a wrong value with no diagnostic. The armed event names are part of the
// interning identity, so the two bodies stay apart -- and the `c` line is
// what says so.
import { EventEmitter } from "node:events"

interface MapA {
    readonly a: (r: { readonly v: number }) => void
    readonly b: (r: { readonly v: number }) => void
}
interface MapB {
    readonly a: (r: { readonly v: number }) => void
    readonly b: (r: { readonly v: number }) => void
    readonly c: (r: { readonly v: number }) => void
}

class Narrow extends EventEmitter {
    public on<K extends keyof MapA>(event: K, listener: MapA[K]): this
    public on(event: string, listener: (...args: unknown[]) => void): this
    public on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener)
    }
    public emit<K extends keyof MapA>(event: K, payload: Parameters<MapA[K]>[0]): boolean
    public emit(event: string, ...args: unknown[]): boolean
    public emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args)
    }
}
class Wide extends EventEmitter {
    public on<K extends keyof MapB>(event: K, listener: MapB[K]): this
    public on(event: string, listener: (...args: unknown[]) => void): this
    public on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener)
    }
    public emit<K extends keyof MapB>(event: K, payload: Parameters<MapB[K]>[0]): boolean
    public emit(event: string, ...args: unknown[]): boolean
    public emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args)
    }
}

interface NarrowC<T = {}> extends Narrow {
    on<K extends keyof (MapA & T)>(event: K, listener: (MapA & T)[K]): this
}
interface WideC<T = {}> extends Wide {
    on<K extends keyof (MapB & T)>(event: K, listener: (MapB & T)[K]): this
}

const n: NarrowC = new Narrow()
const w: WideC = new Wide()
// Two bound values whose slots ERASE ALIKE -- (string, (record) => void) => this
// -- over different key sets. Neither has a contextual type, so both come in
// through the bind expression's own type; the armed set must still separate them.
const onN = n.on.bind(n)
const onW = w.on.bind(w)

onN('a', (r: { readonly v: number }): void => { console.log('N a ' + String(r.v)) })
onN('b', (r: { readonly v: number }): void => { console.log('N b ' + String(r.v)) })
onW('a', (r: { readonly v: number }): void => { console.log('W a ' + String(r.v)) })
onW('c', (r: { readonly v: number }): void => { console.log('W c ' + String(r.v)) })

n.emit('a', { v: 1 })
n.emit('b', { v: 2 })
w.emit('a', { v: 3 })
w.emit('c', { v: 4 })
console.log('N a count ' + String(n.listenerCount('a')))
console.log('W c count ' + String(w.listenerCount('c')))
console.log('done')
