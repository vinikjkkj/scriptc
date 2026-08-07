/* The executable suffix a harness must ASK FOR when it intends to spawn
 * what it just built.
 *
 * Windows will not exec an extensionless file. libuv's spawn hands
 * CreateProcessW an `lpApplicationName`, and that parameter assumes NO
 * default extension — so `.../program` is `spawn ... ENOENT` even though
 * the PE is sitting right there on disk, fully linked and runnable. (The
 * `.exe`-is-appended rule people remember applies to `lpCommandLine`
 * lookups and to PATH searches, not to an explicit application name.
 * Measuring it is the only way to believe it: an extensionless copy spawns
 * fine *if* a sibling `.exe` happens to exist next to it, which is exactly
 * the coincidence that makes this bug look intermittent.)
 *
 * The C driver writes exactly the `-o` name it is given — `zig cc -o
 * program` produces `program`, not `program.exe`. The CLI appends the
 * suffix itself (packages/cli), so production builds are runnable; a
 * HARNESS calling compile() directly owns the suffix, and asking for it
 * here is what makes the produced binary spawnable.
 *
 * No-op off win32. Deliberately NOT used by the cross-target lanes
 * (linux-differential.test.ts) whose artifacts are ELF and run in a Linux
 * container: there the host platform says nothing about the output.
 * windows-differential.test.ts hard-codes `.exe` for the same reason from
 * the other direction — it always targets Windows, whatever the host is.
 */
export const EXE_SUFFIX = process.platform === "win32" ? ".exe" : "";

/** `program` → `program.exe` on win32, unchanged everywhere else. */
export function exeName(stem: string): string {
  return stem + EXE_SUFFIX;
}
