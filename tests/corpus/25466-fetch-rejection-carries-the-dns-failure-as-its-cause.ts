// An unresolvable host: `TypeError: fetch failed` with the getaddrinfo ENOTFOUND error as its cause (code, errno, syscall, hostname).
fetch("http://no-such-host.invalid/").then(
  () => { console.log("unexpected response"); },
  (err) => {
    const e = err as any;
    console.log(e.name, "|", e.message, "| own code:", e.code);
    console.log("cause:", e.cause.name, "|", e.cause.message);
    console.log("cause code/syscall/hostname:", e.cause.code, e.cause.syscall, e.cause.hostname);
  },
);
