// A bound-emit dispatcher over a key map ONE of whose events nothing typed.
//
// `an event NOTHING typed gets a dyn tuple instead of an arity fence` gave the
// program-wide event table a new state: an emit whose argument maps NOWHERE
// (an untyped emitter's callback parameters are `any`, and `any` has no static
// representation) records DYN for that position instead of contributing
// nothing. That removed a real arity fence -- `emit('x') with 1 arguments
// where the event's tuple has 0`, a disagreement with a tuple no one wrote.
//
// It also took a WORKING lowering away, one nothing in the corpus covered.
// `boundEmitDispatcher` builds `this.emit.bind(this)` into a lifted
// `(ev, args)` thunk with one arm per key of the slot's `keyof` map, and its
// per-position `convert()` could answer only a payload-array element that
// typeEquals the tuple position or is a TAGGED ARM of it. Dyn is neither, and
// never can be: it is the ABSENCE of a static arm, so the tag lookup misses
// every time. The arm loop turns a miss into `return why(...)`, which
// abandons the WHOLE dispatcher -- so ONE untyped event put the bind back on
// the emit-as-a-value fence, and with `--best-effort` that fence is a runtime
// throw in a constructor: a build that reports success over a dead binary.
// zapo's `WaClient` died exactly this way, on `debug_transport_decode_error`.
//
// What the arm owes a dyn tuple position is a BOXED payload. The tuple is dyn
// precisely because the bucket holds dyn adapters, and a dyn adapter reads a
// dyn; the slot's array element has a static type, so the crossing is the
// same `dynFrom` the checked-dynamic listener path already performs.
import { EventEmitter } from "node:events";

/** An UNTYPED emitter: no key map, so its listener parameters are `any`. */
class Transport extends EventEmitter {}

interface EvMap {
    // Ordinary: payload read by an annotated listener, so its tuple is pinned.
    readonly ready: (info: { readonly id: number }) => void;
    // The one NOTHING types. Its only emit re-emits `any` values, and its only
    // listener declares no parameters, so the table holds a DYN tuple for it.
    readonly decode_error: (detail: { readonly node: unknown; readonly frame: unknown }) => void;
}

class Bus extends EventEmitter {
    on<K extends keyof EvMap>(event: K, listener: EvMap[K]): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }

    emit<K extends keyof EvMap>(event: K, ...args: Parameters<EvMap[K]>): boolean;
    emit(event: string, ...args: unknown[]): boolean;
    emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }
}

/** The collaborator's dependency record -- zapo's `WaClientRuntimeDependencies`
 * shape, and the reason the dispatcher exists. */
interface Deps {
    readonly emitEvent: <K extends keyof EvMap>(event: K, ...args: Parameters<EvMap[K]>) => void;
}

class Owner extends Bus {
    readonly deps: Deps;

    constructor(transport: Transport) {
        super();
        // THE BIND. On base this refused with SC1090 'the EventEmitter member
        // emit as a VALUE', because of `decode_error` alone.
        this.deps = { emitEvent: this.emit.bind(this) };

        // The emit that makes `decode_error`'s tuple DYN: `node` and `frame`
        // are an untyped emitter's callback parameters, checker type `any`.
        transport.on("wire_error", (node, frame) => {
            this.emit("decode_error", { node, frame });
        });
    }
}

const transport = new Transport();
const owner = new Owner(transport);

const seen: string[] = [];
let decodeErrors = 0;

owner.on("ready", (info) => {
    seen.push(`ready:${String(info.id)}`);
});

// A listener that declares NO parameters: it observes the event without
// pinning its tuple, which is what leaves the tuple free for the dyn record.
owner.on("decode_error", () => {
    decodeErrors += 1;
});

// Through the BOUND value -- the dispatcher's arms, including the dyn one.
owner.deps.emitEvent("ready", { id: 7 });
owner.deps.emitEvent("decode_error", { node: "n1", frame: "f1" });
owner.deps.emitEvent("ready", { id: 8 });

// And through the untyped transport, which is where the dyn tuple came from.
transport.emit("wire_error", { tag: "bad" }, 42);

console.log(seen.join(" "));
console.log(`decodeErrors=${String(decodeErrors)}`);
