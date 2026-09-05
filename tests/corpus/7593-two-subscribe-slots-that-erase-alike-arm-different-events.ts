// Two bound-subscribe slots on ONE receiver whose erased IR function types are
// IDENTICAL and whose armed event sets are not.
//
// `boundSubscribeDispatcher` interns its lifted body so that the same field
// filled from two constructors is one function -- the mould `boundEmitDispatcher`
// set. Interning on (receiver class, member, erased slot type) is not enough,
// and this program is why. Two key maps with the SAME handler type and
// different key sets erase to the same slot: `<K extends keyof MapA>` and
// `<K extends keyof MapB>` both become `(string, (record) => void) => Client`,
// because the erasure takes the constraint's INSTANTIATION and the handler
// union collapses to one arm when every event declares the same handler.
//
// The narrow slot lowers first and claims the interned name. On the erased-type
// key the wide slot then REUSES that body, whose arms are `a` and `b`, and its
// `c` registration is silently dropped: Node prints `c 3` and counts one
// listener, and the compiled program printed neither. No trap, no diagnostic,
// no missing symbol -- a listener that simply never fires. That is the failure
// mode a dispatcher exists to not have, so the ARMED NAMES are part of the
// interning identity rather than a consequence of it.
import { EventEmitter } from "node:events";

type H = (e: { readonly v: number }) => void;

interface MapA {
    readonly a: H;
    readonly b: H;
}
interface MapB {
    readonly a: H;
    readonly b: H;
    readonly c: H;
}

class ClientImpl extends EventEmitter {
    on<K extends keyof MapB>(event: K, listener: MapB[K]): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }
    emit<K extends keyof MapB>(event: K, payload: Parameters<MapB[K]>[0]): boolean;
    emit(event: string, ...args: unknown[]): boolean;
    emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }
}

interface NarrowCtx {
    readonly on: <K extends keyof MapA>(event: K, listener: MapA[K]) => ClientImpl;
}
interface WideCtx {
    readonly on: <K extends keyof MapB>(event: K, listener: MapB[K]) => ClientImpl;
}

const em = new ClientImpl();
/** Lowers FIRST, so it is the one that claims the interned body. */
const narrow: NarrowCtx = { on: em.on.bind(em) };
const wide: WideCtx = { on: em.on.bind(em) };

narrow.on("a", (e: { readonly v: number }): void => {
    console.log("a " + String(e.v));
});
wide.on("c", (e: { readonly v: number }): void => {
    console.log("c " + String(e.v));
});

em.emit("a", { v: 1 });
em.emit("c", { v: 3 });
console.log("a listeners " + String(em.listenerCount("a")));
console.log("c listeners " + String(em.listenerCount("c")));
console.log("done");
