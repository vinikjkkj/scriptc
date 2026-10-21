// K5's init arm: a trap DURING module evaluation routes to the sink the
// same way an export's trap does. Pre-trap stdout passes through to the
// host's fds untouched (library mode never buffers or rebinds them).
const xs = [1, 2, 3];
console.log("about to trap");
// Passing the miss to a typed parameter keeps the documented range trap: a
// consumer that can take Node's undefined (print, ??, arithmetic) now reads
// it instead, so the trap needs a consumer whose slot cannot hold it.
function take(n: number): number {
  return n;
}
const y = take(xs[7]);
console.log(`never ${y}`);
