// crypto.randomFill on the worker pool: 150 concurrent fills, delivered in the
// poll phase, one MakeCallback scope per completion.
//
// Node runs every randomFill on libuv's threadpool and the completions come
// back in no fixed order, so nothing here prints an order of completion. What
// is pinned is what Node guarantees whatever the order:
//  - the whole synchronous run, the nextTick queue and the promise jobs come
//    BEFORE any completion (the call returns before its callback can run);
//  - every completion gets its OWN checkpoint: the nextTick and the promise
//    job a callback queued run before the next callback does, so the log is
//    exactly (cb tick micro)*, never cb cb tick tick;
//  - each callback runs once, receives (null, the SAME buffer) and the bytes
//    are written in place, only inside the named range;
//  - all 150 completions are delivered before a 100 ms timer (the pool drains
//    long before it) and a timer scheduled at the end of the last callback
//    runs after it.
// Random bytes are never printed; a 16-byte target stays all-zero with
// probability 2^-128, so "changed" is a certain fact.
import { randomFill } from "node:crypto";

const N = 150;
const log: string[] = [];
const targets: Uint8Array[] = [];
for (let i = 0; i < N; i++) targets.push(new Uint8Array(16));
// A sentinel on both sides of a ranged fill: only the named range may change.
const ranged = new Uint8Array(24);
for (let i = 0; i < ranged.length; i++) ranged[i] = 0x5a;

let delivered = 0;
let sameBuffer = 0;
let nullErr = 0;
let allDone: () => void = () => {};

function onDone(target: Uint8Array): (err: Error | null, buf: Uint8Array) => void {
  return (err: Error | null, buf: Uint8Array): void => {
    delivered++;
    if (err === null) nullErr++;
    if (buf === target) sameBuffer++;
    log.push("cb");
    process.nextTick(() => log.push("tick"));
    Promise.resolve().then(() => log.push("micro"));
    if (delivered === N + 1) {
      setTimeout(() => {
        log.push("after-last");
        allDone();
      }, 0);
    }
  };
}

for (let i = 0; i < N; i++) {
  const t = targets[i]!;
  randomFill(t, onDone(t));
}
randomFill(ranged, 8, 8, onDone(ranged));

// Synchronous code, then ticks, then promise jobs: all before a completion.
log.push("sync");
process.nextTick(() => log.push("tick0"));
Promise.resolve().then(() => log.push("micro0"));
console.log("sync-return delivered", delivered);

const timer = setTimeout(() => {
  console.log("timer100 delivered", delivered);
}, 100);

new Promise<void>((resolve) => {
  allDone = resolve;
}).then(() => {
  clearTimeout(timer);
  // The log: the prologue, then (cb tick micro) per completion, then the timer.
  const head = log.slice(0, 3).join(" ");
  const body = log.slice(3, 3 + 3 * (N + 1)).join(" ");
  const tail = log.slice(3 + 3 * (N + 1)).join(" ");
  console.log("prologue", head);
  console.log("per-completion checkpoints", /^(cb tick micro )*cb tick micro$/.test(body), body.split(" ").length);
  console.log("tail", tail);
  console.log("delivered", delivered, "nullErr", nullErr, "sameBuffer", sameBuffer);
  let changed = 0;
  for (let i = 0; i < N; i++) {
    let nz = 0;
    for (let k = 0; k < 16; k++) if (targets[i]![k] !== 0) nz++;
    if (nz > 0) changed++;
  }
  console.log("changed", changed);
  let intact = 0;
  for (let k = 0; k < 8; k++) if (ranged[k] === 0x5a) intact++;
  for (let k = 16; k < 24; k++) if (ranged[k] === 0x5a) intact++;
  let filled = 0;
  for (let k = 8; k < 16; k++) if (ranged[k] !== 0x5a) filled++;
  console.log("ranged outside intact", intact, "inside changed", filled > 0);
});
