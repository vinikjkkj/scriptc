// A 'readable' listener that calls read(), on the same stream a `for
// await` is iterating.
//
// Node answers this one way round and scriptc answered it the other: the
// listener runs from emitReadable_'s nextTick and read() empties the
// buffer THERE, so the listener takes every chunk and the loop ends up
// with none — it exits when the stream does. scriptc used to answer the
// loop from inside push(), before the tick, so the LOOP took all four and
// the listener took none.
//
// It is also the shape that a wake left marked pending hangs forever on:
// the tick that would answer the loop finds the buffer already drained,
// and if that spent wake is not cleared no later push can queue another
// one. The program below deadlocked under exactly that bug, which is why
// the watchdog is here — a hang is a test that never reports.
import { Readable } from "node:stream";

const r = new Readable({ read() {} });
let taken = 0;
r.on("readable", () => {
  const c = r.read();
  if (c !== null) {
    taken += 1;
    console.log("listener took " + String(c.length) + " bytes");
  }
});

let i = 0;
const t = setInterval(() => {
  i += 1;
  r.push("c" + String(i));
  if (i === 4) {
    r.push(null);
    clearInterval(t);
  }
}, 10);

async function main(): Promise<void> {
  for await (const c of r) console.log("loop " + String(c.length));
  console.log("loop done, listener took " + String(taken));
}

void main();
