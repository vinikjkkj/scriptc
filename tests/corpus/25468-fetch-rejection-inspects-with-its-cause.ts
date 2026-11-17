// console.log of the rejection of a refused fetch: Node prints the TypeError, then `[cause]: Error: connect ECONNREFUSED ...` with the cause's own
// properties (errno, code, syscall, address, port). The stack lines are not comparable across runtimes, so both errors carry a fixed stack.
fetch("http://127.0.0.1:61999/").then(
  () => { console.log("unexpected response"); },
  (err) => {
    const e = err as any;
    e.stack = e.name + ": " + e.message;
    e.cause.stack = e.cause.name + ": " + e.cause.message;
    console.log(e);
  },
);
