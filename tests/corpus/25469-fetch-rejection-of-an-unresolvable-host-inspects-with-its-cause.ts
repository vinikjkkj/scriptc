// console.log of the rejection of a fetch to an unresolvable host: `[cause]: Error: getaddrinfo ENOTFOUND host` with errno, code, syscall and
// hostname. The stack lines are not comparable across runtimes, so both errors carry a fixed stack.
fetch("http://no-such-host.invalid/").then(
  () => { console.log("unexpected response"); },
  (err) => {
    const e = err as any;
    e.stack = e.name + ": " + e.message;
    e.cause.stack = e.cause.name + ": " + e.cause.message;
    console.log(e);
  },
);
