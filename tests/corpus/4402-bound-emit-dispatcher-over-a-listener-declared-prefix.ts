// `emit.bind(this)` handed to a generic key-map slot, where ONE of the map's
// events has a listener that ignores its payload.
//
// The bound-emit dispatcher is what makes the coordinator idiom compile: a
// class hands its own `emit` to a collaborator through
//
//     readonly emitEvent: <K extends keyof EvMap>(event: K, ...args: Parameters<EvMap[K]>) => void
//
// and the compiler builds one monomorphised thunk that switches on the name
// and calls the per-event specialization. It used to demand that every armed
// event's unified tuple match the key map's declared arity EXACTLY, and any
// single event that failed declined the WHOLE dispatcher -- the bind then
// fell back to the emit-as-a-value fence, which `--best-effort` turns into a
// throwing stub that fires at the first call.
//
// Exact equality is the wrong gate, and a typed-events library fails it as a
// matter of course. The program-wide event table unifies a tuple from the
// `.emit(` and `.on(` sites a syntactic scan can see -- and an emit routed
// THROUGH this very slot is a call on a function-typed field, not one of
// them. So an event whose only emits go through the slot has exactly one
// contributor: its listeners. A consumer who writes `c.on('tick', () => {
// ticks += 1 })` -- a listener that ignores its payload -- leaves that event
// at a ZERO tuple while the map declares one, and the library's constructor
// stopped compiling because of it.
//
// The honest gate is the payload ARRAY's end: the slot hands the arms one
// array the caller filled from `Parameters<EvMap[K]>`, so a tuple LONGER than
// the map's arity would index past the allocation. A tuple SHORTER is the
// prefix rule -- the table's tuple is the maximum over every registered
// listener, so nothing anywhere reads the trailing slots.
import { EventEmitter } from "node:events";

interface EvMap {
    // Payload READ by its listener: a full 1-tuple.
    readonly ping: (e: { readonly seq: number }) => void;
    // Payload IGNORED by its listener: a 0-tuple against a map arity of 1.
    readonly tick: (label: string) => void;
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

/** The collaborator's dependency record -- the shape the dispatcher exists
 * for, and the shape zapo's `WaClientRuntimeDependencies` declares. */
interface Deps {
    readonly emitEvent: <K extends keyof EvMap>(event: K, ...args: Parameters<EvMap[K]>) => void;
}

/** The library class, in zapo's own spelling: the emitter IS the owner, and
 * it hands its own `emit` to its dependency record from its CONSTRUCTOR --
 * which is why the refusal landed there rather than at a call site. */
class Owner extends Bus {
    readonly deps: Deps;

    constructor() {
        super();
        // The bind. On base this refused, and every call through `emitEvent`
        // threw the emit-as-a-value stub.
        this.deps = { emitEvent: this.emit.bind(this) };
    }

    run(): void {
        this.deps.emitEvent("ping", { seq: 1 });
        this.deps.emitEvent("tick", "a");
        this.deps.emitEvent("ping", { seq: 2 });
        this.deps.emitEvent("tick", "b");
    }
}

const owner = new Owner();
const seen: string[] = [];
let ticks = 0;

// Reads the payload.
owner.on("ping", (e) => {
    seen.push(`ping:${String(e.seq)}`);
});

// IGNORES the payload -- this listener is what used to break the constructor.
owner.on("tick", () => {
    ticks += 1;
});

owner.run();

console.log(seen.join(" "));
console.log(`ticks=${String(ticks)}`);
