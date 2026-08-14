// The second half of the `chainBlocked` conversion, and the half the
// promise site did not need.
//
// Several receivers cannot be discriminated by their IR type at all —
// AsyncLocalStorage, diagnostics_channel's Channel, readline's Interface and
// TracingChannel are all f64 handles; StringDecoder is a one-field record;
// TextEncoder/TextDecoder are stdlib interfaces. Those lowerings gate on
// PROVENANCE instead, with a predicate of the shape "true when `node`'s
// checker type is X" — and every one of them asked
// `checker.getTypeAtLocation(node)` directly.
//
// That call does NOT see the optional chain's narrow. `L.typeOf` does: it
// consults `chainNarrowedType`, which lowerOptionalChain populates for the
// guarded receiver precisely so downstream receiver-kind checks agree with
// the value the chain bound. So converting the `?.` guard alone was not
// enough for these — the guard opened and the predicate immediately closed
// it again, having been handed the un-narrowed `X | undefined` whose symbol
// is the union's, not X's. Both halves are needed, and this fixture is what
// tells them apart: it would fail with either one missing.

import { StringDecoder } from "node:string_decoder";
import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";

// ── StringDecoder: a record receiver, discriminated by provenance ──────
function pickDecoder(on: boolean): StringDecoder | undefined {
    return on ? new StringDecoder("utf8") : undefined;
}

const d = pickDecoder(true);
// A euro sign split across three write() calls: the decoder must hold the
// partial sequence across the chained calls, which only works if each call
// reaches the REAL decoder rather than a fresh one.
console.log("part 1:", JSON.stringify(String(d?.write(Buffer.from([0xe2])))));
console.log("part 2:", JSON.stringify(String(d?.write(Buffer.from([0x82])))));
console.log("part 3:", JSON.stringify(String(d?.write(Buffer.from([0xac, 0x41])))));
console.log("end:", JSON.stringify(String(d?.end())));

const noDecoder = pickDecoder(false);
console.log("absent write:", String(noDecoder?.write(Buffer.from([0x41]))));
console.log("absent end:", String(noDecoder?.end()));

// ── TextEncoder / TextDecoder: stdlib interfaces, chained ──────────────
// The codecs are declared as VALUES in the fallback lib, so the receiver
// type is spelled off an instance rather than by name.
const encoder0 = new TextEncoder();
const decoder0 = new TextDecoder();
function pickEncoder(on: boolean): typeof encoder0 | undefined {
    return on ? encoder0 : undefined;
}
function pickTextDecoder(on: boolean): typeof decoder0 | undefined {
    return on ? decoder0 : undefined;
}

let srcEvals = 0;
function src(): string {
    srcEvals = srcEvals + 1;
    return "hi€";
}

const encoded = pickEncoder(true)?.encode(src());
console.log("encoded:", encoded === undefined ? "none" : encoded.join(","));
console.log("src evals:", srcEvals);
const notEncoded = pickEncoder(false)?.encode(src());
console.log("not encoded:", notEncoded === undefined ? "none" : "some");
console.log("src evals (unchanged):", srcEvals);

console.log("decoded:", String(pickTextDecoder(true)?.decode(new Uint8Array([0x68, 0x69]))));
console.log("not decoded:", String(pickTextDecoder(false)?.decode(new Uint8Array([0x68, 0x69]))));

// ── AsyncLocalStorage: an f64 store handle ─────────────────────────────
function pickAls(on: boolean): AsyncLocalStorage<number> | undefined {
    return on ? new AsyncLocalStorage<number>() : undefined;
}
const als = pickAls(true);
console.log("store before:", String(als?.getStore()));
als?.run(41, () => {
    console.log("store inside:", String(als?.getStore()));
});
console.log("store after:", String(als?.getStore()));
console.log("absent store:", String(pickAls(false)?.getStore()));

// ── diagnostics_channel: another f64 handle ────────────────────────────
function pickChannel(on: boolean) {
    return on ? channel("scriptc.test.3583") : undefined;
}
const ch = pickChannel(true);
let seen = 0;
ch?.subscribe(() => {
    seen = seen + 1;
});
ch?.publish({ n: 1 });
console.log("published, seen:", seen);
const noCh = pickChannel(false);
noCh?.publish({ n: 2 });
console.log("absent publish is a no-op, seen:", seen);
