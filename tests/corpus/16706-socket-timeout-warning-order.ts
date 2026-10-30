// @exit: 3
// Two overflowing calls and a user nextTick, in call order: the warnings are
// deferred to the tick queue exactly where process.emitWarning puts them.
import * as net from "net";

process.on("warning", (w: any) => {
  console.log("warning", w.message.split("\n")[0]);
});

const a = new net.Socket();
const b = new net.Socket();
a.setTimeout(3000000000);
process.nextTick(() => console.log("tick one"));
b.setTimeout(4294967296);
console.log("sync end");
a.destroy();
b.destroy();
process.exitCode = 3;
