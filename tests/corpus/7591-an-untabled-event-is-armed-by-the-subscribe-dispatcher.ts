// An event the program-global table has no entry for, registered through a
// bound `on` slot.
//
// `boundEmitDispatcher` SKIPS such a key: nothing anywhere listens to it, so
// emitting it is a runtime no-op and the fallthrough is exact. The mirror of
// that argument is NOT available to the subscribe side. Skipping would leave
// the listener unregistered where Node registers it, and `listenerCount` and
// `rawListeners` both see the difference -- a wrong VALUE with no diagnostic,
// which is the one shape a dispatcher must never produce.
//
// So the arm is built anyway, from the key map's OWN declared handler, whose
// parameter list IS the event's tuple when no other site named it. That is
// sound rather than optimistic: every emit's event name must be a
// compile-time string literal (`eventNameOf`), a literal-named emit on an
// emitter-rooted receiver always enters the table, and a slot-routed emit --
// bound or loose -- arms only names the table already holds. A name absent
// from the table can therefore be listened for and never fired, which is
// exactly what this program pins: `quiet` counts 1 listener, the body never
// runs, and `off` takes it back out.
import { EventEmitter } from "node:events";

interface EvMap {
    readonly loud: (e: { readonly n: number }) => void;
    /** Nothing emits it and nothing else listens for it. */
    readonly quiet: (e: { readonly s: string }) => void;
    /** Nor this one, and its handler declares TWO parameters, so the tuple
     * the arm invents has to be the whole declared list and not a prefix. */
    readonly silent: (a: number, b: string) => void;
}

class ClientImpl extends EventEmitter {
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
    emit<K extends keyof EvMap>(event: K, payload: Parameters<EvMap[K]>[0]): boolean;
    emit(event: string, ...args: unknown[]): boolean;
    emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }
}

interface Client<TPluginEvents = {}> extends ClientImpl {
    on<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this;
    off<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this;
    emit<K extends keyof (EvMap & TPluginEvents)>(
        event: K,
        payload: Parameters<Extract<(EvMap & TPluginEvents)[K], (...args: never[]) => unknown>>[0],
    ): boolean;
}

interface Ctx {
    readonly on: Client["on"];
    readonly off: Client["off"];
}

const client: Client = new ClientImpl();
const ctx: Ctx = { on: client.on.bind(client), off: client.off.bind(client) };

const quietly = (e: { readonly s: string }): void => {
    console.log("quiet MUST NOT FIRE " + e.s);
};
const silently = (a: number, b: string): void => {
    console.log("silent MUST NOT FIRE " + String(a) + b);
};

ctx.on("loud", (e: { readonly n: number }): void => {
    console.log("loud " + String(e.n));
});
ctx.on("quiet", quietly);
ctx.on("silent", silently);

client.emit("loud", { n: 9 });
console.log("loud " + String(client.listenerCount("loud")));
console.log("quiet " + String(client.listenerCount("quiet")));
console.log("silent " + String(client.listenerCount("silent")));
ctx.off("quiet", quietly);
console.log("quiet after off " + String(client.listenerCount("quiet")));
console.log("done");
