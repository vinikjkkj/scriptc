// Mirrors zapo-js's shape: a typed event map behind typed on/emit overloads.
// Two events, identical but for ONE thing -- ev_rec's payload names a
// SELF-RECURSIVE interface (BinaryNode's shape), ev_flat's does not.
import { EventEmitter } from 'node:events'

interface Rec {
    readonly tag: string
    readonly attrs: Readonly<Record<string, string>>
    readonly content?: Uint8Array | string | readonly Rec[]
}

interface Map1 {
    readonly ev_flat: (event: { readonly err: Error; readonly frame: Uint8Array }) => void
    readonly ev_rec: (event: { readonly node: Rec; readonly frame: Uint8Array }) => void
}

class Probe extends EventEmitter {
    public emit<K extends keyof Map1>(event: K, ...args: Parameters<Map1[K]>): boolean
    public emit(event: string | symbol, ...args: unknown[]): boolean
    public emit(event: string | symbol, ...args: unknown[]): boolean {
        return super.emit(event, ...args)
    }

    fire(frame: Uint8Array, node: Rec): void {
        this.emit('ev_flat', { err: new Error('x'), frame })
        this.emit('ev_rec', { node, frame })
    }
}

const probe = new Probe()
probe.fire(new Uint8Array([1, 2]), { tag: 't', attrs: {} })
console.log('EMIT-ARITY4: reached the end')
