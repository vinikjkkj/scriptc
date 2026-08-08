// The platform-conditional detached idiom: `...(isWindows ? {} : {
// detached: true })` (and the carrying-arm-first orientation) inside
// spawn's options — the condition decides setsid at runtime. The child
// reports its own process group into a file; detached ⇔ pgid == pid.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "scr-spawn-cs-"));
const isWindows = process.platform === "win32";

// The redirection target is a word in a shell script, and `sh` strips an
// unquoted backslash as an escape. On Windows the interpolated
// G:\...\scr-spawn-cs-XXXXXX\a.txt therefore reached the child as the
// single filename "G:zapo-work...a.txt" (with ':' folded to U+F03A), which
// the child created in the CWD — so the redirect silently succeeded, the
// readFileSync below threw ENOENT, and the program exited 1 while
// littering the repository root. NODE DOES THIS TOO: it is sh, not the
// runtime, and the differential failed only because a nonzero exit is not
// the declared expectation. Windows paths cannot contain a single quote,
// so single-quoting the word is a total fix.
const shArg = (p: string): string => `'${p}'`;

const detachedChild = spawn("sh", ["-c", `ps -o pgid= -p $$ > ${shArg(join(dir, "a.txt"))}`], {
  stdio: "ignore",
  ...(isWindows ? {} : { detached: true }),
});
detachedChild.on("exit", (code) => {
  console.log(`detached exit: ${code}`);
  const pgid = readFileSync(join(dir, "a.txt"), "utf-8").trim();
  console.log("own group:", pgid === `${detachedChild.pid}`);

  // The other orientation, condition false: stays attached — the child's
  // pgid is the parent's, not its own.
  const attached = spawn("sh", ["-c", `ps -o pgid= -p $$ > ${shArg(join(dir, "b.txt"))}`], {
    stdio: "ignore",
    ...(isWindows ? { detached: true } : {}),
  });
  attached.on("exit", (code2) => {
    console.log(`attached exit: ${code2}`);
    const pgid2 = readFileSync(join(dir, "b.txt"), "utf-8").trim();
    console.log("shares group:", pgid2 !== `${attached.pid}`);
    rmSync(dir, { recursive: true, force: true });
  });
});
console.log("spawned");
