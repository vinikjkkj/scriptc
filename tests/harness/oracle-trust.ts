/* Is a Node run something the harness may REMEMBER as the answer?
 *
 * The oracle cache stores Node's verdict for a corpus program keyed by the
 * program bytes. A record that describes a run which never really happened
 * poisons every later comparison in that directory — the compiled binary is
 * measured against a verdict Node did not give — and the failure looks
 * exactly like a compiler regression. This predicate is the only thing
 * standing between the cache and that, so it lives here with a test rather
 * than inside the suite it guards.
 *
 * Three rules, all about a run that produced NO TRUSTWORTHY EVIDENCE:
 *
 *  - An exit code of 0x40000000 or more is an NTSTATUS: the OS reporting on
 *    the process rather than a JS exit code. Two have been observed on this
 *    box. 0xC0000142 STATUS_DLL_INIT_FAILED is Windows refusing to START
 *    node under memory pressure — it cost an earlier block three
 *    reproductions to rule out a compiler regression. 0x40010004
 *    DBG_TERMINATE_PROCESS is Windows KILLING node: a host restart landed
 *    mid-run and left a record holding 923 of the program's 939 stdout
 *    bytes. The guard only covered the ERROR severity (>= 0xC0000000), so
 *    the killed run — informational severity, and with a non-empty stdout —
 *    was trusted, and 2746-hkdf-sha256.ts read as a stdout divergence for
 *    every later run in that directory. A PARTIAL record is the most
 *    dangerous kind: it looks like a real answer and it is merely short.
 *    No corpus program declares an exit code above 13, so the whole
 *    NTSTATUS range is refused outright.
 *
 *  - A non-zero exit with BOTH streams empty is not an answer either: Node
 *    prints a stack for an uncaught throw and the harness compares stderr,
 *    so a silent non-zero exit is a run that did not happen — UNLESS the
 *    program declares that code with `// @exit:` (those are deliberate).
 *
 *  - Exit 0 is always an answer.
 *
 * The guard is applied on the WRITE (nothing poisoned is stored) and on the
 * READ (a directory poisoned by an older harness heals itself instead of
 * failing until someone deletes the file by hand). The failure mode is
 * symmetric — the same record manufactures a phantom PASS for any program
 * whose compiled output is also empty — which is why this refuses rather
 * than repairing.
 */

/** The lowest NTSTATUS value: severity bits 01 (informational). Anything at
 * or above this is the OS speaking, not the program. */
export const NTSTATUS_FLOOR = 0x40000000;

export function oracleIsTrustworthy(
  res: { exitCode: number; stdout: { length: number }; stderr: { length: number } },
  declaredExit: number,
): boolean {
  if (res.exitCode >= NTSTATUS_FLOOR) return false;
  if (res.exitCode === 0) return true;
  if (res.stdout.length > 0 || res.stderr.length > 0) return true;
  return declaredExit === res.exitCode;
}
