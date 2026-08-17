// A typed-events class RE-EMITTING an untyped emitter's payload — and the
// two ways a consumer's own listener used to decide whether the class's
// CONSTRUCTOR compiled.
//
// The shape is zapo's `WaClient`. An inner `EventEmitter` subclass carries no
// typed `on` overloads, so its listener parameters are checker-`any`; the
// outer class re-emits them as one typed payload record and declares the
// usual overload pair
//
//     on  <K extends keyof M>(event: K, listener: M[K]): this
//     on  (event: string, listener: (...args: unknown[]) => void): this
//     emit<K extends keyof M>(event: K, payload: Parameters<M[K]>[0]): boolean
//     emit(event: string, ...args: unknown[]): boolean
//
// Two things then went wrong, BOTH of them decided by what the CONSUMER
// wrote, at a statement inside the library's own constructor:
//
//   * a listener that USES the payload pinned a 1-tuple, and the re-emit's
//     object literal — assembled out of `any`-typed callback parameters —
//     had no mappable type of its own AND a contextual type of `unknown`
//     (tsc resolves the payload argument through the FORWARDING overload),
//     so the literal lowering refused it: "values of type 'unknown'";
//
//   * a listener that IGNORES the payload pinned a ZERO-tuple, and the same
//     statement failed the arity check instead: "emit('...') with 1
//     arguments where the event's tuple has 0".
//
// Both are fixed at the emitter, which knew the answer all along. The event's
// unified tuple is the type the registered listeners actually receive, so an
// object-literal payload builds at that shape (each property coercing into
// its field through the checked dyn extraction, exactly as a hand-written
// `node as BinaryNode` would); and arguments past a tuple no emit ever pinned
// are the prefix rule's own trailing positions — no listener anywhere
// declared a parameter to receive them, so nothing reads them.
//
// Both spellings run here at once, on two events of the same class, so the
// program covers the pair a single consumer would actually write.
import { EventEmitter } from "node:events";

interface Node {
    readonly tag: string;
    readonly attrs: Record<string, string>;
}

interface ClientEvents {
    // The consumer USES this payload.
    readonly node_in: (e: { readonly node: Node; readonly frame: Uint8Array }) => void;
    // The consumer IGNORES this payload.
    readonly node_out: (e: { readonly node: Node; readonly bytes: number }) => void;
}

/** The inner transport: an UNTYPED EventEmitter, so its listener parameters
 * are `any` and everything built out of them is unmappable. */
class Transport extends EventEmitter {
    deliverIn(node: Node, frame: Uint8Array): void {
        this.emit("raw_in", node, frame);
    }

    deliverOut(node: Node, bytes: number): void {
        this.emit("raw_out", node, bytes);
    }
}

class Client extends EventEmitter {
    private readonly transport: Transport;

    constructor(transport: Transport) {
        super();
        this.transport = transport;
        // The two re-emits. Neither parameter is annotated -- this is the
        // library's own code, and it is what used to stop compiling.
        this.transport.on("raw_in", (node, frame) => this.emit("node_in", { node, frame }));
        this.transport.on("raw_out", (node, bytes) => this.emit("node_out", { node, bytes }));
    }

    on<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }

    emit<K extends keyof ClientEvents>(event: K, payload: Parameters<ClientEvents[K]>[0]): boolean;
    emit(event: string, ...args: unknown[]): boolean;
    emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }
}

const seen: string[] = [];
const transport = new Transport();
const client = new Client(transport);

// Uses the payload: pins a 1-tuple, and the re-emit's record must be BUILT at
// it out of two dyn values.
client.on("node_in", (e) => {
    seen.push(`in ${e.node.tag} attrs=${String(Object.keys(e.node.attrs).length)} frame=${String(e.frame.length)}`);
});

// Ignores the payload: pins a 0-tuple, and the re-emit's one argument is the
// trailing position nothing reads.
let outs = 0;
client.on("node_out", () => {
    outs += 1;
});

transport.deliverIn({ tag: "iq", attrs: { id: "1", type: "get" } }, new Uint8Array([1, 2, 3]));
transport.deliverIn({ tag: "message", attrs: {} }, new Uint8Array(7));
transport.deliverOut({ tag: "presence", attrs: { from: "me" } }, 42);
transport.deliverOut({ tag: "iq", attrs: {} }, 9);

console.log(seen.join(" | "));
console.log(`outs=${String(outs)}`);
