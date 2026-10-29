// process.stdout / process.stderr WriteStream state under REAL @types/node:
// the typed reads (direct, through a let alias, through the pgpass warn
// guard) answer Node's values. The dynamic view is in the corpus (15460).
import { Stream } from "stream";
const out = process.stdout;
console.log(String(out.writable), String(out.writableHighWaterMark), String(out.writableEnded));
console.log(String(out.writableFinished), String(out.writableObjectMode), String(out.writableCorked));
console.log(String(out.destroyed), String(out.closed));
var warnStream = process.stderr;
function warn(msg: string): void {
  var isWritable = (warnStream instanceof Stream && true === warnStream.writable);
  if (isWritable) {
    warnStream.write("warn: " + msg + "\n");
  }
}
warn("first");
let alias = process.stderr;
console.log("alias " + String(alias.writable) + " " + String(alias.writableHighWaterMark) + " " + String(alias.closed));
