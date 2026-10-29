// The pgpass warn idiom: a module-level alias of process.stderr guarded by
// instanceof Stream and .writable, then written to. stderr carries the
// diagnostics; stdout reports which branch ran.
import { Stream } from "stream";
var warnStream: any = process.stderr;
function warn(msg: string, n: number): void {
  var isWritable = (warnStream instanceof Stream && true === (warnStream as any).writable);
  if (isWritable) {
    warnStream.write("warn: " + msg + " " + String(n) + "\n");
  }
}
warn("first", 1);
warn("second", 2);
console.log("guard ran: " + String(warnStream.writable));
