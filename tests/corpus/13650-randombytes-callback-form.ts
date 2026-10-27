// `crypto.randomBytes(size, callback)` -- Node's CALLBACK form.
//
// The bytes are random, so no row compares them. Every row prints a DERIVED
// fact (length, Buffer.isBuffer, err === null, the order of the callback
// against synchronous code, nextTick, promise jobs and a later timer, the
// messages Node throws for a bad size, and that two calls differ).
//
// The callback is called on a LATER loop turn: Node runs the fill on the
// threadpool. Rows pin only the order that does not depend on threadpool
// timing: after synchronous code, after process.nextTick and after promise
// jobs, and before a 20 ms timer. The order against a setImmediate is NOT
// pinned: Node measured it both ways across runs in principle.
//
// The spelling is the cast call, the same one the diffieHellman callback
// rows use, because the shipped fallback declarations carry only the
// one-argument overload.

import { randomBytes } from "node:crypto";

type RandomBytesCallback = (err: Error | null, buf: Buffer) => void;

const order: string[] = [];

function note(s: string): void {
  order.push(s);
}

function randomBytesCb(size: number, cb: RandomBytesCallback): void {
  (randomBytes as unknown as (n: number, c: RandomBytesCallback) => void)(size, cb);
}

// r01: the callback's facts, and the order it runs in.
randomBytesCb(8, (err: Error | null, buf: Buffer) => {
  note("cb8 err=" + (err === null) + " len=" + buf.length + " isBuffer=" + Buffer.isBuffer(buf));
});
note("sync-after-call");

// r02: nextTick and a promise job both run before the callback.
process.nextTick(() => note("tick"));
Promise.resolve().then(() => note("promise"));

// r03: a 20 ms timer runs after the callback.
setTimeout(() => {
  note("timer20");
  console.log(order.join(" | "));
  finish();
}, 20);

// r04: two calls return different bytes.
let first = "";
let second = "";
randomBytesCb(16, (_err: Error | null, buf: Buffer) => {
  first = buf.toString("hex");
});
randomBytesCb(16, (_err: Error | null, buf: Buffer) => {
  second = buf.toString("hex");
});

// r05: a zero-length fill still calls back with an empty Buffer.
// Node calls back SYNCHRONOUSLY for a zero-length fill (randomFill's size===0
// path), so "cb0" is noted before "after0".
randomBytesCb(0, (err: Error | null, buf: Buffer) => {
  note("cb0 err=" + (err === null) + " len=" + buf.length + " isBuffer=" + Buffer.isBuffer(buf));
});
note("after0");

// r06: a fractional size is truncated, as in the synchronous form.
randomBytesCb(1.5, (err: Error | null, buf: Buffer) => {
  console.log("frac", err === null, buf.length);
});

// r07: the synchronous form still answers the same length.
console.log("sync-form", randomBytes(5).length);

// r08: bad sizes throw synchronously, before any callback is queued.
function badSize(size: number): void {
  let queued = false;
  try {
    (randomBytes as unknown as (n: number, c: RandomBytesCallback) => void)(size, () => {
      queued = true;
    });
    console.log("no throw", size);
  } catch (e) {
    const err = e as Error;
    console.log(err.name, err.message);
  }
  if (queued) console.log("queued-after-throw");
}
badSize(-1);
badSize(2 ** 31);
badSize(NaN);

let finished = false;
function finish(): void {
  if (finished) return;
  finished = true;
  console.log("first-differs", first !== "", second !== "", first !== second, first.length, second.length);
}
