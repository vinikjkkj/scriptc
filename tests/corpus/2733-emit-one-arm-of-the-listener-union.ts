// An emit site supplying ONE ARM of the union a listener declares.
//
// Each event name carries one argument tuple that every emit site and every
// listener of that name must agree on. Agreement used to mean type EQUALITY,
// which rejects the ordinary discriminated-union event: the listener declares
// the whole union, and each emit writes a literal for one arm. The event then
// conflicted, and a conflicted event fences EVERY site that touches it.
//
// The arm IS the agreement. The emit's payload is lowered expecting the
// unified tuple, so the literal is wrapped into the union right at the emit —
// the listener observes exactly the type it declared, and no shape reaches it
// that its own union does not admit.
//
// The union may only ever come from the LISTENER side. An emit widening a
// position past what a listener declared is the unsound direction and keeps
// the conflict; that case is not exercised here, since a corpus program only
// holds programs that compile.
import { EventEmitter } from "node:events";

type Conn =
    | { readonly status: "open"; readonly code: null; readonly tries: number }
    | { readonly status: "close"; readonly code: number | null; readonly tries: number };

class Client extends EventEmitter {
    open(tries: number): void {
        // One arm, written as a literal.
        this.emit("conn", { status: "open", code: null, tries });
    }

    close(code: number | null): void {
        // The other arm, with a different `code` type.
        this.emit("conn", { status: "close", code, tries: 0 });
    }

    passthrough(event: Conn): void {
        // The whole union, which always agreed.
        this.emit("conn", event);
    }
}

const seen: string[] = [];
const client = new Client();

// The listener declares the UNION -- this is what pins the tuple. It narrows
// on the discriminant before reading the arm-specific field, which is the
// only way to read one anyway.
client.on("conn", (event: Conn) => {
    if (event.status === "open") {
        seen.push(`open:null:${event.tries}`);
        return;
    }
    seen.push(`close:${event.code === null ? "null" : event.code}:${event.tries}`);
});

// A second listener of the same union, so the merge runs listener-to-listener too.
client.on("conn", (event: Conn) => {
    if (event.status !== "close") return;
    seen.push(`closed(${event.code === null ? "null" : event.code})`);
});

client.open(2);
client.close(401);
client.close(null);
client.passthrough({ status: "open", code: null, tries: 9 });

console.log(seen.join(" "));
