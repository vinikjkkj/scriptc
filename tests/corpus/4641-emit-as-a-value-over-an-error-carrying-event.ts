// THE `emit` TRAMPOLINE, OVER AN EVENT WHOSE PAYLOAD CARRIES AN `Error`.
//
// 4403 already compiles `emit.bind(this)` into a dispatcher against a LOOSE
// plugin surface. This file is that program with ONE thing changed: one of
// the declared events carries `{ error: Error }` instead of a plain record.
// That single field is the whole difference between a program that compiles
// and one that does not, and it is why the row this file closes survived the
// change that built the dispatcher in the first place.
//
// WHAT USED TO HAPPEN. `looseEmitDispatcher` arms one event at a time and
// requires each armed event's single payload type to be `canDynCheckTo` —
// the dyn payload the surface carries has to be validatable INTO it, or the
// dispatcher would hand a listener a value nobody checked. `canDynCheckTo`
// admits `%Error` STANDING ALONE (the checked-dynamic tree's error encoding,
// `{%error, name, message, code?}`, extracted through the runtime's identity
// cache) and its own NESTED walker did not, so `{ error: Error }` — the same
// `%Error`, one container down — was refused. One event out of twenty-seven
// declining took the whole dispatcher with it, and the bind fell back to the
// emit-as-a-value fence:
//
//     SC1090: the EventEmitter member 'emit' as a VALUE (it is the runtime's,
//     and every call compiles against a statically known event name — each
//     event has its own payload tuple, so no single function value exists to
//     bind or pass; ...)
//
// which `--best-effort` turns into a stub that throws at the plugin's first
// emit. That is the shape of zapo's `install.ts:76`,
// `emit: client.emit.bind(client) as unknown as WaClientPluginContext['emit']`,
// whose event map declares `debug_client_error: { error: Error }`.
//
// THE TRAP, MEASURED. Delete the `Error` from the payload below — make
// `client_error` carry `{ code: string }` instead, changing nothing else —
// and the program COMPILES AND PASSES ON BASE, because that is 4403. So a
// reduction of this row that does not carry an `Error` inside a payload
// record tests nothing at all: it passes on the unfixed compiler.
//
// AND THE LOUD HALF. The holder of a bound emit picks the NAME and the
// PAYLOAD independently — nothing at runtime pairs them — so the extraction
// is the checked `dynCheck`, not a narrow. The two calls at the bottom pair
// `client_error` with payloads that are not `{ error: Error }`; both refuse.
// Node refuses at the first USE the wrong value cannot serve (reading
// `.message.length` off a number), scriptc at the boundary; the texts name
// different sites and are not pinned, but the part that MUST agree is: the
// wrong payload does not quietly reach the listener.
import { EventEmitter } from "node:events";

interface ClientEvents {
    readonly ready: (e: { readonly at: string }) => void;
    // The row this file exists for.
    readonly client_error: (e: { readonly error: Error }) => void;
    // Declared, listened to by nobody: the dispatcher must not arm it, and
    // must still answer `false` for it rather than fencing the whole value.
    readonly idle: (e: { readonly why: string }) => void;
}

/** What a plugin is handed. Loose on purpose: a plugin's own events are not
 * in the client's map, so the surface admits any name and any payload. */
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

    // The forwarding arm takes `string`, not `string | symbol` — 4403's note:
    // the corpus compiles against scriptc's FALLBACK node declarations, whose
    // `EventEmitter.emit` is `(event: string, ...)`. The LOOSE SLOT above
    // keeps `string | symbol`; it is this file's own interface.
    emit<K extends keyof ClientEvents>(event: K, ...args: Parameters<ClientEvents[K]>): boolean;
    emit(event: string, ...args: unknown[]): boolean;
    emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }
}

const client = new Client();
const seen: string[] = [];

client.on("ready", (e) => {
    seen.push(`ready@${e.at}`);
});
// `.message.length` and not just `.message`: the length read is what makes
// the two bad calls below throw in NODE as well, so "threw" is Node's own
// answer and not a normalisation hiding a divergence.
client.on("client_error", (e) => {
    seen.push(`err:${e.error.message}/${String(e.error.message.length)}`);
});

// Everything below goes through the BOUND value, never through a direct emit.
const emit = client.ctx.emit;

seen.push(`r1=${String(emit("ready", { at: "boot" }))}`);
// The row: a payload record carrying an Error, checked out of the packed
// rest array and handed to a listener that reads it as an Error.
seen.push(`e1=${String(emit("client_error", { error: new Error("boom") }))}`);
// Declared by the map, listened to by nobody: false, no arm, no throw.
seen.push(`i1=${String(emit("idle", { why: "quiet" }))}`);
// A name the map does not carry: the fallthrough, which is what Node answers
// for an event with no listeners.
seen.push(`u1=${String(emit("not_an_event", 1))}`);
console.log(seen.join(" "));

// The loud half. Neither of these may reach the listener.
try {
    console.log(`bad1=${String(emit("client_error", 42))}`);
} catch {
    console.log("bad1: threw");
}
try {
    console.log(`bad2=${String(emit("client_error", { error: "not an error" }))}`);
} catch {
    console.log("bad2: threw");
}
