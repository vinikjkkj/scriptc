// the warn slot is swapped to stdout and back; writes follow the slot value.
var warnStream: any = process.stderr;
function warnTo(stream: any): any { const old = warnStream; warnStream = stream; return old; }
function warn(msg: string): void {
  if (warnStream && warnStream.writable === true) warnStream.write(msg + "\n");
}
warn("to-stderr");
const prev = warnTo(process.stdout);
console.log("prev-is-stderr", prev === process.stderr);
warn("to-stdout");
warnTo(prev);
warn("back-to-stderr");
