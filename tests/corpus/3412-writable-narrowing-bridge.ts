// `if (e instanceof Writable) e.write(...)` — the GUARD and the BRIDGE
// have to give the same answer.
//
// `instanceof` on a base-typed value is a preorder-interval test; reading
// a subclass member behind that guard goes through a second, checked
// downcast (`%class.narrow`) which throws when the interval test fails.
// Two separate tests of the same question, so `instanceof Writable`
// answering Node's "a Duplex counts" in one of them and the prototype
// chain's "it does not" in the other is worse than either answer alone:
// the guard admits a PassThrough and the bridge then throws a TypeError
// Node has no equivalent of.
//
// Every value below reaches `feed` through an `EventEmitter` parameter,
// so the guard is the only thing that decides, and the writes that follow
// prove the bridge let the value through with its bytes intact.
import { EventEmitter } from "node:events";
import { Duplex, PassThrough, Readable, Writable } from "node:stream";

class Bus extends EventEmitter {}

class Sink extends Writable {
    public seen: string[] = [];
    public _write(
        chunk: Uint8Array,
        _enc: string,
        cb: (err?: Error) => void,
    ): void {
        this.seen.push(Buffer.from(chunk).toString("utf8"));
        cb();
    }
}

/** The guard under test. `e.write(...)` behind it is the checked
 * downcast; a disagreement between the two shows up here as a throw. */
function feed(e: EventEmitter, s: string): boolean {
    if (e instanceof Writable) {
        e.write(s);
        return true;
    }
    return false;
}

async function collect(r: Readable): Promise<string> {
    const parts: string[] = [];
    r.on("data", (chunk: Uint8Array) => {
        parts.push(Buffer.from(chunk).toString("utf8"));
    });
    await new Promise<void>((resolve) => {
        r.once("end", () => resolve());
    });
    return parts.join("|");
}

async function main(): Promise<void> {
    const bus = new Bus();
    console.log("plain emitter:", feed(bus, "no"));

    const ro = new Readable({ read() {} });
    console.log("readable:", feed(ro, "no"));

    const sink = new Sink();
    console.log("writable:", feed(sink, "yes"), sink.seen.join("|"));

    const pt = new PassThrough();
    const out = collect(pt);
    console.log("passthrough:", feed(pt, "one"), feed(pt, "two"));
    pt.end();
    console.log("passthrough bytes:", await out);

    // The RECORD-FIELD copy of the same widening: an object literal built
    // at shape `{ sink: PassThrough }` flowing into a `{ sink: Writable }`
    // slot. widthLiftPlan carries its OWN "may this instance widen" test,
    // a second copy of coerceToExpected's, and the two have to agree: a
    // top-level call that compiles beside the same value inside an object
    // literal that does not would be worse than either answer alone.
    const boxed = new PassThrough();
    const boxedOut = collect(boxed);
    const box: { label: string; sink: Writable } = { label: "boxed", sink: boxed };
    box.sink.write("field-one");
    box.sink.end("field-two");
    console.log("record field:", box.label, await boxedOut);

    const dx = new Duplex({
        read() {},
        write(chunk: Uint8Array, _enc: string, cb: (err?: Error) => void) {
            console.log("duplex _write:", Buffer.from(chunk).toString("utf8"));
            cb();
        },
    });
    console.log("duplex:", feed(dx, "three"));
    dx.end();
}

await main();
