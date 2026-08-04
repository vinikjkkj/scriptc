// crypto.randomFill — the fill is trivial; the CALLBACK is the feature.
//
// Node invokes it asynchronously, and every deferral queue in this runtime
// holds one ZERO-argument closure per entry. So the call is built at the
// lowering as a thunk that captured the callback and the arguments Node
// passes it, and the queue carries the thunk: the argument's ownership
// becomes the capture box's, released with the closure exactly once
// whether the deferral fires or the loop's teardown drops it at exit.
//
// What this pins: the three argument shapes, the callback arities JS
// allows (0, 1 and 2 parameters — the second argument is the SAME buffer,
// never a copy), the station (after the whole nextTick/microtask
// checkpoint, before the check phase), Node's synchronous offset/size
// range ladder, and the fact that only the named range is written. Random
// bytes are never printed — only shapes, lengths and booleans.
//
// The fills are CHAINED, one in flight at a time: Node completes
// concurrent randomFills on threadpool threads and their relative order is
// genuinely nondeterministic (five runs, four different orders), so a
// program that observed it would be comparing a coin flip.
import { randomFill } from "node:crypto";

const order: string[] = [];

// The offset/size ladder throws SYNCHRONOUSLY, in Node's order (offset,
// then size, then the sum) — the error reaches the caller's catch, never
// the callback. The thunk it was handed is released on the way out.
const bad = new Uint8Array(8);
const never = (error: Error | null): void => {
  order.push(`SHOULD NOT RUN ${error === null}`);
};
try {
  randomFill(bad, -1, 1, never);
  console.log("no-throw offset");
} catch (e) {
  console.log(e instanceof RangeError, (e as Error).message);
}
try {
  randomFill(bad, 9, 0, never);
  console.log("no-throw offset-past-end");
} catch (e) {
  console.log(e instanceof RangeError, (e as Error).message);
}
try {
  randomFill(bad, 0, -2, never);
  console.log("no-throw size");
} catch (e) {
  console.log(e instanceof RangeError, (e as Error).message);
}
try {
  randomFill(bad, 4, 99, never);
  console.log("no-throw sum");
} catch (e) {
  console.log(e instanceof RangeError, (e as Error).message);
}
// The whole target unchanged: a refused call fills nothing.
let untouched = 0;
for (let i = 0; i < bad.length; i++) if (bad[i] === 0) untouched++;
console.log("bad untouched", untouched);

// A ZERO-length draw answers IN LINE — Node's own quirk, and the reason
// the two lines below print in this order.
const target5 = new Uint8Array(3);
for (let i = 0; i < target5.length; i++) target5[i] = 0xcc;
randomFill(target5, 1, 0, (): void => {
  let kept = 0;
  for (let i = 0; i < 3; i++) if (target5[i] === 0xcc) kept++;
  console.log("zero-length in line, kept", kept);
});
console.log("after the zero-length call");

// The buffers of the chain, and the callbacks Node's arities allow.
const target0 = new Uint8Array(4);
const target1 = new Uint8Array(8);
const target2 = new Uint8Array(6);
const target3 = new Uint8Array(8);
const target4 = new Uint8Array(8);
for (let i = 0; i < target3.length; i++) target3[i] = 0xaa;
for (let i = 0; i < target4.length; i++) target4[i] = 0xbb;

// The zapo shape: ONE parameter, typed `Error | null`. That parameter is a
// class instance inside a union, which has no dyn representation — the
// reason the boxed thunk cannot carry it and the typed one must.
const onDone = (error: Error | null): void => {
  order.push(error === null ? "one-param:null" : "one-param:err");
};

const step4 = (): void => {
  let outside = 0;
  for (let i = 0; i < 8; i++) if (i < 2 || i >= 5) { if (target4[i] === 0xbb) outside++; }
  order.push(`size-form outside=${outside}`);
  order.push("chain done");
};
const step3 = (): void => {
  let head = 0;
  for (let i = 0; i < 4; i++) if (target3[i] === 0xaa) head++;
  order.push(`offset-form head=${head}`);
  // offset AND size: only [2,5) is written.
  randomFill(target4, 2, 3, step4);
};
const step2 = (err: Error | null, buf: Uint8Array): void => {
  // Both parameters. Node hands back the SAME buffer object.
  order.push(`two-param:${err === null}:${buf === target2}:${buf.length}`);
  // offset only: the size defaults to the rest of the buffer.
  randomFill(target3, 4, step3);
};
const step1 = (error: Error | null): void => {
  onDone(error);
  randomFill(target2, step2);
};
// A zero-parameter callback: JS drops the arguments Node passes.
randomFill(target0, (): void => {
  order.push("zero-param");
  randomFill(target1, step1);
});

// THE STATION. The first fill's callback lands after this whole
// checkpoint — after both the tick and the microtask — and before the
// immediate registered here, which prints once the chain has run.
process.nextTick(() => order.push("tick"));
Promise.resolve().then(() => order.push("micro"));
order.push("sync");

// A DEFERRED CALL WITH AN ARGUMENT, written directly: process.nextTick's
// trailing arguments over the same `Error | null` parameter that no dyn
// box can hold. Same facility, no crypto involved.
process.nextTick(onDone, null);
process.nextTick((err: Error | null, buf: Uint8Array): void => {
  order.push(`tick-two:${err === null}:${buf.length}`);
}, null, new Uint8Array(2));

setTimeout(() => {
  order.push("late timer");
  console.log(order.join(" | "));
}, 30);
