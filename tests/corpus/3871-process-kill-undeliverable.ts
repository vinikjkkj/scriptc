// process.kill's signal ladder, and the one answer a host that cannot
// DELIVER a signal owes its caller: a THROW, not a death.
//
// Windows has no signals. libuv's uv_kill resolves the process FIRST
// (a pid it cannot open answers ESRCH/EPERM whatever the signal is),
// then range-checks the number, then terminates for exactly
// SIGINT/SIGQUIT/SIGKILL/SIGTERM, probes for 0, and answers
// `Error: kill ENOSYS` for every other signal in range — a CATCHABLE
// error. The compiled runtime used to call TerminateProcess(self, 1)
// for those instead, so `process.kill(process.pid, "SIGWINCH")` killed
// the caller where Node throws: the program below printed its first
// line and then nothing.
//
// On POSIX the same calls deliver the (ignored) signal and answer true.
// Node is the oracle on each host, so what this program pins is not one
// platform's answers but the SHAPE they share: every call RETURNS, the
// error is an Error the program catches, and the last line prints.
// Signal 28 is SIGWINCH on Linux, macOS and libuv-on-Windows alike, and
// its POSIX default disposition is ignore — self-signalling is safe.
const pid = process.pid;
console.log("before:", pid > 0);

function attempt(label: string, f: () => boolean): void {
  try {
    console.log(`${label}: returned ${f()}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "?";
    console.log(`${label}: threw ${msg} type=${e instanceof TypeError}`);
  }
}

// Signal 0 is the liveness probe on every host.
attempt("probe self", () => process.kill(pid, 0));

// The undeliverable one, by name and by number: ENOSYS on Windows,
// delivered-and-ignored on POSIX. Either way the caller lives.
attempt("winch by name", () => process.kill(pid, "SIGWINCH"));
attempt("winch by number", () => process.kill(pid, 28));

// Out of every host's signal range: EINVAL before anything is sent.
attempt("signo 9999", () => process.kill(pid, 9999));
attempt("signo -1", () => process.kill(pid, -1));

// A pid above every host's pid_max but inside int32: the process is
// resolved BEFORE the signal is looked at, so an undeliverable signal
// to a dead pid answers for the pid, not for the signal. The last one
// is where the two orders visibly disagree: Windows answers for the pid
// (ESRCH) and Linux's kill(2) validates the signal first (EINVAL).
attempt("esrch probe", () => process.kill(99999999, 0));
attempt("esrch winch", () => process.kill(99999999, 28));
attempt("esrch out of range", () => process.kill(99999999, 9999));

// Unknown NAMES are a TypeError before any kill(2) happens.
attempt("bad name", () => process.kill(pid, "SIGNOPE"));

// The line the silent death used to eat.
console.log("after: still running");
