// execSync runs the command through the PLATFORM's shell, the way Node's
// child_process does: `/bin/sh -c <command>` on POSIX, and on Windows
// `%ComSpec%` (cmd.exe) with `/d /s /c "<command>"` and libuv's verbatim
// argument flag — /d skips AutoRun, /s makes cmd strip exactly the outer
// quote pair and take the rest of the line as typed, /c runs and exits.
//
// The frontend lowers the shell to the POSIX spelling at compile time, so
// the platform switch has to happen where the child is actually spawned.
// Before it did, every execSync on Windows resolved /bin/sh to ENOENT and
// threw, while execFileSync("sh", ...) in the same program worked fine
// (it PATH-searches and Git ships an sh.exe) — which is what pinned the
// root to the shell spelling rather than to shell execution generally.
//
// Node is the oracle on whichever platform runs this, so nothing below
// assumes one platform's answer: the raw capture keeps whatever line
// ending the shell emits ("\n" under sh, "\r\n" under cmd) and both sides
// must produce the same bytes.
import { execSync } from "node:child_process";

// Raw capture — the trailing newline belongs to the shell.
console.log("raw:", JSON.stringify(execSync("echo scriptc-shell-ok", { encoding: "utf8" })));
// ...and normalised, so this line reads identically on every platform.
console.log("trimmed:", JSON.stringify(execSync("echo scriptc-shell-ok", { encoding: "utf8" }).trim()));

// A second call is independent of the first.
console.log("again:", JSON.stringify(execSync("echo second", { encoding: "utf8" }).trim()));

// A non-zero exit throws Node's Error, whose message names the COMMAND
// the user wrote — never the shell that ran it. (stdio "pipe" keeps the
// child's stderr out of ours; the harness compares stderr byte-for-byte.)
try {
  execSync("exit 7", { encoding: "utf8", stdio: "pipe" });
  console.log("no-throw");
} catch (e) {
  console.log("failed:", e instanceof Error ? e.message : "?");
}

// Exit 0 through the shell captures the empty string, not undefined.
console.log("empty:", JSON.stringify(execSync("exit 0", { encoding: "utf8", stdio: "pipe" })));

// The shell form composes with `input` (an empty stdin is a pipe the
// child reads EOF from, distinct from the option being absent).
console.log("input:", JSON.stringify(execSync("exit 0", { encoding: "utf8", input: "", stdio: "pipe" })));

// Statement position: the capture nobody reads still runs the child.
execSync("exit 0", { stdio: "pipe" });
console.log("done");
