// @exit: 3
// An overflowing delay with a callback warns through the process channel,
// clamps, and still registers the callback (the 'warning' listener sees it).
import * as net from "net";

process.on("warning", (w: any) => {
  console.log("warning", w.name, JSON.stringify(w.message));
});
const s = new net.Socket();
const r = s.setTimeout(3000000000, () => console.log("never in this run"));
console.log("sync", r === s);
s.destroy();
process.exitCode = 3;
