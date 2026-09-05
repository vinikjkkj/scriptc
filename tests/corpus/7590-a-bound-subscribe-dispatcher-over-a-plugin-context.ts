// `on`/`off`/`once` bound into a plugin-context record -- the other half of
// the coordinator idiom `boundEmitDispatcher` already answers.
//
// zapo's `installWaClientPlugins` writes four lines running:
//
//     emit:  client.emit.bind(client) as unknown as Ctx['emit'],
//     on:    client.on.bind(client),
//     off:   client.off.bind(client),
//     once:  client.once.bind(client),
//
// and until now only the first compiled. The member read alone has no value
// for the same reason emit's does not -- `on` monomorphizes per literal event
// name, so no single function exists to take the address of -- so the three
// remaining lines were the EventEmitter-member-as-a-VALUE fence, and with it
// the whole plugin surface.
//
// `boundSubscribeDispatcher` builds the value the same way: a lifted
// `(ev, listener)` thunk with one `strEq` arm per event the slot's key map
// admits, each arm registering with a STATIC name so the event keeps its own
// tuple. Three things make it a different animal from the emit side, and all
// three are exercised here.
//
// THE LISTENER COMES OUT OF AN IR UNION. The direct path types a callback
// from its syntax node; the slot's second parameter is the erased `EvMap[K]`,
// which maps to the union of every event's declared handler. Each arm
// extracts its own handler with the CHECKED narrow (`checkedArmHelper`), so a
// pair the type system did not actually bind -- an `any` forwarder pairing
// 'alpha' with 'beta''s listener -- throws the catchable TypeError instead of
// calling a closure through the wrong signature.
//
// THE SLOT RETURNS `this`. Node's `on` is chainable and the erased return
// type is the receiver's class, so the arm hands back the captured receiver.
// `chained` below reads a field off it to prove the identity is the emitter
// and not some fresh object.
//
// `off` MUST FIND WHAT `on` REGISTERED, across BOTH paths: a listener
// registered through the slot is removed directly here, and one registered
// directly is removed through the slot. Both work because the union payload
// is the closure pointer rather than a copy, and the runtime matches
// listeners by identity.
import { EventEmitter } from "node:events";

interface EvMap {
    readonly alpha: (e: { readonly n: number }) => void;
    readonly beta: (e: { readonly s: string }) => void;
    readonly gamma: (e: { readonly flag: boolean; readonly tag: string }) => void;
}

class ClientImpl extends EventEmitter {
    readonly label: string;
    constructor(label: string) {
        super();
        this.label = label;
    }
    on<K extends keyof EvMap>(event: K, listener: EvMap[K]): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }
    off<K extends keyof EvMap>(event: K, listener: EvMap[K]): this;
    off(event: string, listener: (...args: unknown[]) => void): this;
    off(event: string, listener: (...args: unknown[]) => void): this {
        return super.off(event, listener);
    }
    once<K extends keyof EvMap>(event: K, listener: EvMap[K]): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this {
        return super.once(event, listener);
    }
    emit<K extends keyof EvMap>(event: K, payload: Parameters<EvMap[K]>[0]): boolean;
    emit(event: string, ...args: unknown[]): boolean;
    emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }
}

/** The PUBLISHED surface: a generic interface over the impl class, whose own
 * `on` spells `<K extends keyof (EvMap & TPluginEvents)>`. A type NODE
 * resolves in the scope it was written in, so that constraint enumerates
 * nothing while `TPluginEvents` is open -- the dispatcher reads the closed map
 * off the receiver CLASS instead, the same second road `looseEmitDispatcher`
 * already takes for `emit`. */
interface Client<TPluginEvents = {}> extends ClientImpl {
    on<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this;
    off<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this;
    once<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this;
    emit<K extends keyof (EvMap & TPluginEvents)>(
        event: K,
        payload: Parameters<Extract<(EvMap & TPluginEvents)[K], (...args: never[]) => unknown>>[0],
    ): boolean;
}

interface Ctx {
    readonly on: Client["on"];
    readonly off: Client["off"];
    readonly once: Client["once"];
    readonly emit: (event: string, ...args: unknown[]) => boolean;
    readonly id: string;
}

const client: Client = new ClientImpl("core");
const base: Ctx = {
    on: client.on.bind(client),
    off: client.off.bind(client),
    once: client.once.bind(client),
    emit: client.emit.bind(client) as unknown as Ctx["emit"],
    id: "base",
};

const seenAlpha = (e: { readonly n: number }): void => {
    console.log("shared alpha " + String(e.n));
};

/** The FACTORY shape: a base literal built once and SPREAD into a per-plugin
 * literal that overrides one data field. Each plugin captures its own id. */
function install(id: string): void {
    const ctx: Ctx = { ...base, id };
    const chained: ClientImpl = ctx.on("beta", (e: { readonly s: string }): void => {
        console.log(id + " beta " + e.s);
    });
    console.log(id + " chained to " + chained.label);
    ctx.once("gamma", (e: { readonly flag: boolean; readonly tag: string }): void => {
        console.log(id + " gamma " + e.tag + " " + String(e.flag));
    });
}

install("p1");
install("p2");

// The shared listener goes in through the slot and comes out DIRECTLY.
base.on("alpha", seenAlpha);
// And one registered directly comes out through the SLOT.
const direct = (e: { readonly n: number }): void => {
    console.log("direct alpha " + String(e.n));
};
client.on("alpha", direct);

client.emit("alpha", { n: 1 });
client.emit("beta", { s: "one" });
// Both `once` registrations fire here and neither fires again.
base.emit("gamma", { flag: true, tag: "g1" });
client.emit("gamma", { flag: false, tag: "g2" });

client.off("alpha", seenAlpha);
base.off("alpha", direct);
client.emit("alpha", { n: 2 });
console.log("alpha " + String(client.listenerCount("alpha")));
console.log("beta " + String(client.listenerCount("beta")));
console.log("gamma " + String(client.listenerCount("gamma")));
console.log("done");
