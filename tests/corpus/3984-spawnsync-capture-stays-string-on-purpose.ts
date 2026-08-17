// spawnSync's stdout/stderr stay a plain `string` in the IR ON PURPOSE.
// This file pins the parts that ARE Node-exact and records, for whoever
// comes next, the measured price of the obvious "fix" — so nobody spends
// the afternoon rediscovering it.
//
// THE DIVERGENCE. Node's spawnSync result has THREE states for a capture
// field, measured against Node v25.9.0:
//
//     spawn succeeded, captured    stdout === "<text>"   (a string)
//     spawn succeeded, stdio:      stdout === null       (typeof object)
//       "inherit" (nothing captured)
//     spawn FAILED (ENOENT, ...)   stdout === undefined  (and output null)
//
// This runtime answers "" for all three. The failure arm is the one that
// bites: a program doing `r.stdout.length` after a failed spawn gets a
// V8 TypeError from Node ("Cannot read properties of undefined (reading
// 'length')") and a 0 from us. On POSIX the corpus rarely reaches it —
// a spawn failure needs a deliberately absent binary — but on Windows
// every `/bin/sh` in a POSIX-written program is a spawn failure, which is
// how three corpus programs (1360, 1482, 1537) found it at once.
//
// THE PRICE OF WIDENING THE TYPE, measured, not guessed. Changing the
// spawnRes.stdout/stderr lowering in lower-exprs.ts from `type: STRING`
// to the interned `string | undefined` union (with maybeNarrow, exactly
// how spawnRes.status and spawnRes.error already build their unions),
// then rebuilding and compiling those same three programs:
//
//     1360-spawn-sync                    ran wrong  ->  SC9001 x2
//     1482-spawnsync-error               ran wrong  ->  SC9001
//     1537-os-release-spawnsync-stdio    ran wrong  ->  SC9001 x2
//
//     SC9001: internal compiler error: in %init.0: libCall
//     spawnRes.stdout must be string, got union - please report this
//
// Three wrong answers became three programs that do not compile. That is
// strictly worse for a compiler whose goal is to compile real programs,
// and a flat trap census scores it as an IMPROVEMENT, because a program
// that never compiles emits no traps at all. Do not take that trade.
//
// RE-MEASURED (block/spawn). The mechanism above is exactly right and the
// SC9001 text is verbatim, but the PRICE was understated in two ways, so
// the counts are corrected here rather than left to be rediscovered:
//
//   * The refusal counts are larger: 1360 answers SC9001 x11, not x2
//     (every capture read in the file, stdout and stderr both), 1482 x1,
//     1537 x2.
//   * A FOURTH file breaks, and it is one that passes today on BOTH
//     platforms: 1655-spawnsync-neutral, SC9001 x4. That is the
//     platform-neutral spawn fixture -- the one written precisely because
//     "the older spawn fixtures reach for /bin/sh, which no Windows box
//     has". Widening the type takes out the replacement along with the
//     three it was meant to rescue.
//
// AND THE NEXT WALL, measured rather than predicted. Doing the first TWO
// items of the list below together -- the lowering AND the IR verifier's
// signature (result: VOID plus the arms check, exactly how spawnRes.status
// and spawnRes.signal already do it) -- gets 1537 to COMPILE. The binary
// then dies at the first capture read with an ACCESS VIOLATION, exit
// 0xC0000005, after printing only the two os.release() lines. So the
// honest price of a partial is not a compile refusal at all: it is a
// SEGFAULT, which is worse than both the wrong answer and the fence. The
// third item is not optional plumbing to be done later -- the emitters
// build a union out of a libCall whose C function still hands back a plain
// ScrStr *, and nothing in between checks.
//
// The fourth item stayed untested: nothing reached it.
//
// WHAT A REAL FIX NEEDS, in the order the compile refusals name it:
// the IR verifier's signature for spawnRes.stdout/stderr; the C emitter
// and the LLVM emitter's union construction for those libCalls; a runtime
// result that distinguishes captured-empty from uncaptured from
// never-spawned (today all three are an empty ScrStr); and finally the
// member-access path has to reach the walker that throws V8's real
// message, or `r.stdout.length` merely trades a wrong number for a
// different wrong answer. Until all of that lands together, "" is the
// honest single answer and this file is the note explaining why.
import { spawnSync } from "node:child_process";

// A spawn FAILURE is fully Node-exact everywhere except the capture
// fields, which this file does not read. A binary by this name exists on
// no platform, so the arm is the same for Node and for us.
const missing = spawnSync("definitely-not-a-binary-xyz", [], { encoding: "utf8" });
console.log("status null:", missing.status === null);
console.log("error set:", missing.error !== undefined);
if (missing.error) {
  console.log("error is Error:", missing.error instanceof Error);
  const errno = missing.error as NodeJS.ErrnoException;
  console.log("code:", `${errno.code}`, errno.code === "ENOENT");
  console.log("message:", missing.error.message);
}

// The optional-chained read off the cast — the narrowing idiom real code
// uses to decide whether a tool is installed.
const probe = spawnSync("definitely-not-a-binary-xyz", ["--version"], { encoding: "utf8" });
console.log("absent:", (probe.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT");

// The guard shape: error first, then status. Both arms are Node-exact.
function describe(cmd: string): string {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
  if (r.error) {
    const errno = r.error as NodeJS.ErrnoException;
    return `spawn failed (${errno.code})`;
  }
  if (r.status !== 0) return `exited ${r.status}`;
  return "ran";
}
console.log(describe("definitely-not-a-binary-xyz"));
console.log(describe("also-not-a-real-binary-qqq"));

// Two failed spawns do not interfere, and the result is an ordinary value.
const a = spawnSync("definitely-not-a-binary-xyz", [], { encoding: "utf8" });
const b = a;
console.log("stable:", a.status === null, b.status === null, a.error !== undefined);
