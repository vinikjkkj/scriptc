// A user `_read` that THROWS. Node's Readable.prototype.read wraps the
// `this._read(...)` call in a try/catch and hands what it threw to
// errorOrDestroy: the stream emits 'error' then 'close' and the process
// keeps going. scriptc let the exception escape the read and crashed the
// process with an uncaught report instead — measured against Node
// v25.9.0 before the fix.
import { Readable } from "node:stream";

// A: throws on the FIRST _read, with a listener attached.
const a = new Readable({
  read(): void {
    throw new Error("first read");
  },
});
a.on("data", (d: Buffer) => console.log("a data", d.length));
a.on("error", (e: Error) => console.log("a error:", e.message));
a.on("close", () => console.log("a close"));
console.log("a destroyed before:", a.destroyed);

// B: throws on the SECOND _read, after one good chunk — the error has to
// land after the delivered data, not before it.
let n = 0;
const b = new Readable({
  read(): void {
    n += 1;
    if (n === 1) {
      b.push(Buffer.from("ok"));
      return;
    }
    throw new Error("second read");
  },
});
b.on("data", (d: Buffer) => console.log("b data", d.toString()));
b.on("error", (e: Error) => console.log("b error:", e.message));
b.on("close", () => console.log("b close"));

// C: a subclass whose _read throws a SUBCLASS of Error — the payload
// reaches the listener unchanged.
class Boom extends Error {}
const c = new Readable({
  read(): void {
    throw new Boom("subclass");
  },
});
c.on("error", (e: Error) => console.log("c error:", e.name, e.message, e instanceof Boom));
c.on("close", () => console.log("c close"));
c.resume();

console.log("sync tail");
