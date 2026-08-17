// `emit.bind(this)` handed to a LOOSE emit surface -- the plugin-context
// shape, cast through `unknown`.
//
// A typed-events library that accepts plugins publishes a deliberately loose
// emit for them, because a plugin's own events are not in the client's map:
//
//     readonly emit: (event: string | symbol, ...args: unknown[]) => boolean
//
// and fills it the only way that type-checks, `client.emit.bind(client) as
// unknown as Ctx['emit']`. Two things then stopped this compiling, and both
// were about information the compiler had and did not use.
//
//   * `as unknown as T` makes tsc give the inner expression the contextual
//     type `unknown`, which erases the destination the program named. The
//     assertion chain is walked now and the OUTERMOST asserted type is the
//     slot -- what the author wrote down.
//   * that slot maps to `(string | symbol, ONE dyn) -> bool`: no payload
//     array, no `keyof` constraint, and an event parameter admitting symbols.
//     So the key set comes from the receiver CLASS's own declared event map
//     (its `emit` overload's `<K extends keyof M>`), the payload extraction
//     is the checked `dynCheck`, a symbol -- or any name the map does not
//     carry -- falls through to `false` exactly as Node answers for an event
//     with no listeners, and the REST spelling is read off the declaration so
//     the packed argument array is unpacked rather than handed over whole.
//
// Without those, the bind fell back to the emit-as-a-value fence, which
// `--best-effort` turns into a stub that throws at the plugin's first emit.
import { EventEmitter } from "node:events";

interface ClientEvents {
    readonly ready: (e: { readonly at: string }) => void;
    readonly tick: (n: number) => void;
    // Declared, never listened to: the dispatcher must simply not arm it.
    readonly idle: (e: { readonly why: string }) => void;
}

/** What a plugin is handed. Loose on purpose. */
interface PluginCtx {
    readonly emit: (event: string | symbol, ...args: unknown[]) => boolean;
}

class Client extends EventEmitter {
    readonly ctx: PluginCtx;

    constructor() {
        super();
        this.ctx = { emit: this.emit.bind(this) as unknown as PluginCtx["emit"] };
    }

    on<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }

    emit<K extends keyof ClientEvents>(event: K, ...args: Parameters<ClientEvents[K]>): boolean;
    emit(event: string | symbol, ...args: unknown[]): boolean;
    emit(event: string | symbol, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }
}

const client = new Client();
const seen: string[] = [];

client.on("ready", (e) => {
    seen.push(`ready@${e.at}`);
});
client.on("tick", (n) => {
    seen.push(`tick:${String(n)}`);
});

// Everything below goes through the BOUND value, not through a direct emit.
const emit = client.ctx.emit;

// A record payload, checked out of the packed rest array.
seen.push(`r1=${String(emit("ready", { at: "boot" }))}`);
// A scalar payload.
seen.push(`t1=${String(emit("tick", 7))}`);
// Declared by the map, listened to by nobody: false, no arm, no throw.
seen.push(`i1=${String(emit("idle", { why: "quiet" }))}`);
// A name the map does not carry at all: the fallthrough.
seen.push(`u1=${String(emit("not_an_event", 1))}`);
// A SYMBOL name: no compiled listener bucket is reachable by one.
seen.push(`s1=${String(emit(Symbol("s"), 1))}`);

console.log(seen.join(" "));
