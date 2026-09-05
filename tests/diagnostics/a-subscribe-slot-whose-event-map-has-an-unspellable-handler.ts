// ONE event the arm loop cannot spell takes the WHOLE bound-subscribe slot
// down with it, and this is what that looks like.
//
// `boundSubscribeDispatcher` is arm-by-arm gated rather than best-effort, and
// deliberately so. Skipping a key it cannot build would leave a listener
// unregistered where Node registers it -- a wrong VALUE with no diagnostic,
// which is the one outcome a dispatcher must never produce. So a key whose
// handler the key map does not spell plainly (here a REST parameter list,
// which has no fixed tuple) declines the entire dispatcher, and the read falls
// back to the EventEmitter-member-as-a-VALUE fence that names the real gap.
//
// The refusal is loud and it is at compile time. The alternative -- arming
// what can be armed and quietly dropping the rest -- is the shape this file
// exists to keep out.
import { EventEmitter } from "node:events";

interface EvMap {
    readonly ok: (e: { readonly n: number }) => void;
    /** No fixed tuple: `keyMapHandler` declines it, and with it every arm. */
    readonly wide: (...args: number[]) => void;
}

class ClientImpl extends EventEmitter {
    on<K extends keyof EvMap>(event: K, listener: EvMap[K]): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }
    emit<K extends keyof EvMap>(event: K, payload: Parameters<EvMap[K]>[0]): boolean;
    emit(event: string, ...args: unknown[]): boolean;
    emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }
}

interface Client<TPluginEvents = {}> extends ClientImpl {
    on<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this;
}

interface Ctx {
    readonly on: Client["on"];
}

const client: Client = new ClientImpl();
const ctx: Ctx = { on: client.on.bind(client) };
ctx.on("ok", (e: { readonly n: number }): void => {
    console.log(String(e.n));
});
client.emit("ok", { n: 1 });
