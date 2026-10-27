// An objectMode Readable piped into a byte Writable: the first object is
// refused by the destination's write (ERR_INVALID_ARG_TYPE, the value's
// "Received" tail), the destination closes, the source stays open and paused.
import { Readable, Writable } from "node:stream";

const r = new Readable({ objectMode: true, read() {} });
const w = new Writable({ write(c, e, cb) { console.log("write got", typeof c); cb(); } });
w.on("error", (e) => console.log("W error", e.code, JSON.stringify(e.message), e.name));
w.on("close", () => console.log("W close"));
r.pipe(w);
r.push({ a: 1 });
setTimeout(() => console.log("after", "R destroyed", r.destroyed, "paused", r.isPaused(), "W destroyed", w.destroyed), 20);
