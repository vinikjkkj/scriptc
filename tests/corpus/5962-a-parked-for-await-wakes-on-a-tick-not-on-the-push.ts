// A `for await` that is PARKED — the buffer was empty when it asked — is
// not woken by the push. Node's iterator is sitting on `await new
// Promise(next)` with 'readable'/'end' handlers registered, and what
// resumes it is emitReadable_, a process.nextTick. The read that produces
// the chunk runs THERE, three microtask turns before the loop body.
//
// The runtime answered such a waiter from inside push() instead: the chunk
// arrived two turns early, and — because the read had already emptied the
// buffer — 'end' was enqueued a whole phase early too, from the push that
// filled the stream rather than from the microtask that drained it.
//
// The nextTick markers around each push place the wake: both of them run
// before the chunk on either side, which is what says the wake is a tick
// and not the push. The ruler then counts the turns that follow it.
import { Readable } from "node:stream";

let n = 0;
let era = 0;

function tick(k: number): void {
  if (k === era && n < 20) {
    n += 1;
    void Promise.resolve().then(() => {
      tick(k);
    });
  }
}

function ruler(): void {
  era += 1;
  n = 0;
  const k = era;
  void Promise.resolve().then(() => {
    tick(k);
  });
}

async function main(): Promise<void> {
  const r = new Readable({ read() {} });
  let i = 0;
  const step = (): void => {
    i += 1;
    process.nextTick(() => {
      console.log("  tick before push " + String(i));
    });
    ruler();
    r.push("c" + String(i));
    process.nextTick(() => {
      console.log("  tick after push " + String(i));
    });
    if (i < 3) setTimeout(step, 5);
    else r.push(null);
  };
  setTimeout(step, 5);

  for await (const c of r) console.log("chunk " + String(c) + " @" + String(n));
  console.log("end @" + String(n));

  // The other parked shape: the stream ends while the loop waits, with no
  // chunk at all to deliver.
  const e = new Readable({ read() {} });
  setTimeout(() => {
    ruler();
    e.push(null);
  }, 5);
  for await (const c of e) console.log("never " + String(c));
  console.log("empty end @" + String(n));
  console.log("done");
}

void main();
