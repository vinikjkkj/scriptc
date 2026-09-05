// The dispatch-correctness half: WHICH emitter, and WHICH body.
//
// A dispatcher that picked a body by proving a receiver's runtime class would
// run and print something plausible with no diagnostic at all, so the shape
// that would catch it is the one built here. Three live emitters -- two of one
// class and one of a subclass -- each carry their own bound context, and the
// contexts are shuffled through an array so no call site knows which emitter
// it registers on. A SECOND producer of the same context interface is an
// ordinary object literal with a body of its own, and it is picked at run
// time alongside the bound ones.
//
// The events are deliberately confusable: two carry the same field name with
// a different type, two share an IDENTICAL declared handler (so the slot's
// listener union has fewer arms than the map has keys and one arm serves two
// names), and two are records of the same width whose fields are declared in
// the opposite order. If any arm ever matched the wrong name, or narrowed the
// wrong listener out of the union, the printed lines cross.
import { EventEmitter } from "node:events";

interface EvMap {
    readonly one: (e: { readonly v: number }) => void;
    readonly two: (e: { readonly v: string }) => void;
    /** Same declared handler as `one`: ONE union arm serves both. */
    readonly three: (e: { readonly v: number }) => void;
    readonly four: (e: { readonly a: number; readonly b: number }) => void;
    readonly five: (e: { readonly b: number; readonly a: number }) => void;
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
    emit<K extends keyof EvMap>(event: K, payload: Parameters<EvMap[K]>[0]): boolean;
    emit(event: string, ...args: unknown[]): boolean;
    emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }
}

class Loud extends ClientImpl {
    constructor(label: string) {
        super(label + "!");
    }
}

interface Client<TPluginEvents = {}> extends ClientImpl {
    on<K extends keyof (EvMap & TPluginEvents)>(event: K, listener: (EvMap & TPluginEvents)[K]): this;
    emit<K extends keyof (EvMap & TPluginEvents)>(
        event: K,
        payload: Parameters<Extract<(EvMap & TPluginEvents)[K], (...args: never[]) => unknown>>[0],
    ): boolean;
}

interface Ctx {
    readonly on: Client["on"];
    readonly who: string;
}

const a: Client = new ClientImpl("a");
const b: Client = new ClientImpl("b");
const c: Client = new Loud("c");

const bound = (e: Client, who: string): Ctx => ({ on: e.on.bind(e), who });
/** The SECOND producer: a plain object literal whose `on` has a body. */
const traced: Ctx = {
    who: "T",
    on<K extends keyof EvMap>(event: K, listener: EvMap[K]): Client {
        console.log("T traced " + event);
        return a;
    },
};

function subscribe(ctx: Ctx): void {
    ctx.on("one", (e: { readonly v: number }): void => {
        console.log(ctx.who + " one v=" + String(e.v));
    });
    ctx.on("two", (e: { readonly v: string }): void => {
        console.log(ctx.who + " two v=" + e.v);
    });
    ctx.on("three", (e: { readonly v: number }): void => {
        console.log(ctx.who + " three v=" + String(e.v));
    });
    ctx.on("four", (e: { readonly a: number; readonly b: number }): void => {
        console.log(ctx.who + " four a=" + String(e.a) + " b=" + String(e.b));
    });
    ctx.on("five", (e: { readonly b: number; readonly a: number }): void => {
        console.log(ctx.who + " five b=" + String(e.b) + " a=" + String(e.a));
    });
}

const all: Ctx[] = [bound(b, "B"), traced, bound(c, "C"), bound(a, "A")];
for (const ctx of all) subscribe(ctx);

a.emit("five", { b: 50, a: 51 });
b.emit("four", { a: 40, b: 41 });
c.emit("three", { v: 30 });
a.emit("two", { v: "twenty" });
b.emit("one", { v: 10 });
c.emit("one", { v: 11 });
console.log("a one " + String(a.listenerCount("one")));
console.log("b one " + String(b.listenerCount("one")));
console.log("c one " + String(c.listenerCount("one")));
console.log("done");
