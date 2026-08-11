// A Duplex IS a Writable — in the slot and in `instanceof`.
//
// Node's stream hierarchy has one prototype chain and two interfaces:
// `class Duplex extends Readable implements Writable`. The writable half
// is not on the chain, it is installed by hand — Duplex's constructor
// copies Writable.prototype's methods onto it, and `Writable` carries a
// `Symbol.hasInstance` whose second clause answers true for anything with
// a `_writableState` when the target is `Writable` ITSELF.
//
// So both of these are true in Node and neither follows from
// `Object.getPrototypeOf`:
//
//   * a PassThrough is assignable to a `Writable` parameter;
//   * `new PassThrough() instanceof Writable`.
//
// A compiler whose class forest carries only the prototype chain gets the
// first as a hard fence and the SECOND as a silent `false`. The instanceof
// table below is 25 answers wide on purpose: `Readable instanceof Writable`
// must stay false (the clause is "has a writable side", not "is a
// stream"), and `passThrough instanceof MyWritable` must stay false too —
// Node's clause is guarded by `this === Writable`, so a user subclass of
// Writable is answered by the prototype chain alone.
import { EventEmitter } from "node:events";
import { Duplex, PassThrough, Readable, Transform, Writable } from "node:stream";

/** The slot under test: a plain `Writable` parameter, fed a rw-sided
 * value at every call site below. */
async function drain(w: Writable, chunks: readonly string[]): Promise<void> {
    for (const c of chunks) {
        if (!w.write(c)) {
            await new Promise<void>((resolve) => {
                w.once("drain", () => resolve());
            });
        }
    }
    w.end();
}

/** Every chunk a readable side delivers, joined — the bytes have to be
 * right, not merely un-fenced. */
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

class Upper extends Transform {
    public count = 0;
    public _transform(
        chunk: Uint8Array,
        _enc: string,
        cb: (err?: Error) => void,
    ): void {
        this.count = this.count + 1;
        this.push(Buffer.from(chunk).toString("utf8").toUpperCase());
        cb();
    }
}

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

function table(name: string, value: EventEmitter): void {
    console.log(
        name,
        value instanceof Readable,
        value instanceof Writable,
        value instanceof Duplex,
        value instanceof Transform,
        value instanceof PassThrough,
    );
}

async function main(): Promise<void> {
    // 1. A PassThrough in a `Writable` slot: the bytes come out the
    //    readable side in order.
    const pt = new PassThrough();
    const ptOut = collect(pt);
    await drain(pt, ["alpha", "beta", "gamma"]);
    console.log("passthrough:", await ptOut);

    // 2. A user subclass of Transform in the same slot — the widening has
    //    to reach through `extends`, not just the five builtin names.
    const up = new Upper();
    const upOut = collect(up);
    await drain(up, ["one", "two"]);
    console.log("transform:", await upOut, "transforms:", up.count);

    // 3. A real Writable in the same slot (the case that always worked),
    //    so a regression shows as a diff and not as an absence.
    const sink = new Sink();
    await drain(sink, ["x", "y", "z"]);
    console.log("writable:", sink.seen.join("|"));

    // 4. pipe(): the destination parameter is a Writable too.
    const src = Readable.from(["p", "q"]);
    const mid = new PassThrough();
    const midOut = collect(mid);
    src.pipe(mid);
    console.log("piped:", await midOut);

    // 5. The 25-answer instanceof table.
    console.log("--- instanceof: Readable Writable Duplex Transform PassThrough");
    table("readable  ", new Readable({ read() {} }));
    table(
        "writable  ",
        new Writable({
            write(_c: Uint8Array, _e: string, cb: (err?: Error) => void) {
                cb();
            },
        }),
    );
    table(
        "duplex    ",
        new Duplex({
            read() {},
            write(_c: Uint8Array, _e: string, cb: (err?: Error) => void) {
                cb();
            },
        }),
    );
    table(
        "transform ",
        new Transform({
            transform(c: Uint8Array, _e: string, cb: (err?: Error) => void) {
                cb();
            },
        }),
    );
    table("passthru  ", new PassThrough());
    table("upper     ", new Upper());
    table("sink      ", new Sink());

    // 6. Node's `this === Writable` guard: the extra clause belongs to
    //    Writable itself, so a user subclass of Writable is answered by
    //    the chain alone and a PassThrough is NOT one of its instances.
    console.log("passthru instanceof Sink:", new PassThrough() instanceof Sink);
    console.log("sink instanceof Writable:", new Sink() instanceof Writable);
    console.log("upper instanceof Writable:", new Upper() instanceof Writable);
}

await main();
