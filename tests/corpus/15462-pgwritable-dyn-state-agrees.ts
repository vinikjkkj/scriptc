// Two dynamic views of one process stream read the same WriteStream state
// (one handle identity, one set of answers).
const a: any = process.stdout;
const b: any = process.stdout;
console.log(String(a.writable), String(b.writable), String(a === b));
console.log(String(a.writableCorked), String(b.writableCorked));
console.log(String(a.writableEnded), String(b.writableEnded), String(a.destroyed), String(b.closed));
