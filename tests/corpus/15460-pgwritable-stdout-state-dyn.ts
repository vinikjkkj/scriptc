// The WriteStream state reads of process.stdout through a dynamic view: each
// value is Node's on a pipe, a file and a TTY (writableLength is not here:
// it queues on a pipe, so it keeps its fence).
const out: any = process.stdout;
console.log(String(out.writable), String(out.writableHighWaterMark));
console.log(String(out.writableEnded), String(out.writableFinished), String(out.writableObjectMode));
console.log(String(out.writableCorked), String(out.destroyed), String(out.closed));
