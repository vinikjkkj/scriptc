// Three deliberate runtime TypeErrors on the process object, caught.
//
// On a Windows target `scr_process_getuid`/`getgid` throw a catchable
// TypeError ("process.getuid is not a function") because Node's process
// object simply has no such member there. The emitted call site was
// `double sc_t2 = scr_process_getuid();` with NO pending-exception check,
// so the `0` the C function returns after raising was used as the answer
// and the catch never ran. Same shape for the `process.on("warning", ...)`
// listener check and `process.emitWarning`'s argument grammar, both of
// which raise ERR_INVALID_ARG_TYPE.
//
// On POSIX getuid/getgid answer a number, so this program prints the
// TYPE, not the value — that keeps one fixture honest on both platforms
// while still proving the throw is caught where it is raised.
try {
  const u = process.getuid();
  console.log("uid:", typeof u);
} catch (e) {
  console.log("uid:", e.name, e.message);
}
try {
  const g = process.getgid();
  console.log("gid:", typeof g);
} catch (e) {
  console.log("gid:", e.name, e.message);
}

try {
  process.emitWarning(42);
  console.log("emitWarning: no throw");
} catch (e) {
  console.log("emitWarning:", e.name, e.code);
}

console.log("after");
