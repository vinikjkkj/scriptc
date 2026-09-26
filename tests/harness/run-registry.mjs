/* Which test runs are ALIVE, and since when.
 *
 * The scratch sweep needs one fact before it may delete anything: could a
 * running test still be holding this directory? The first version of that
 * sweep answered with the clock — "written in the last hour" stood in for
 * "in use" — and the proxy is wrong in both directions. A run that died
 * five minutes ago holds nothing, yet everything it wrote is protected, so
 * relaunching a gate after a crash (the single most common way a gate is
 * relaunched) recovered ZERO bytes and the disk stayed full. A run that
 * started ninety minutes ago and is still going holds everything, yet its
 * oldest directories are already past the floor and can be deleted out
 * from under it.
 *
 * So ask the operating system instead. Every run registers itself here at
 * globalSetup and unregisters at teardown; a record whose pid is gone is
 * not a live run no matter how recent its timestamp, and a record whose
 * pid answers is a live run no matter how old.
 *
 * WHY START TIME IS THE RIGHT PROTECTION BOUNDARY. A live run can only be
 * holding a scratch directory it has touched, and it cannot have touched
 * anything before it started. Touching always writes: on a cache MISS the
 * compiler emits the .c and links the binary into the directory, and on a
 * cache HIT backend/cc.ts still copies the cached binary and renames it
 * onto outPath there ("On a hit the cached binary is copied and atomically
 * renamed onto outPath"). Either way the directory's newest mtime moves to
 * now. Therefore everything a live run may be holding has mtime >= that
 * run's startedAt, and sparing exactly that set is both sufficient and
 * tight. Evicting an older directory that the run happens to reuse LATER
 * is safe by the scratch tree's own design: nothing there is a build
 * input, so the miss costs one copyFile and the binary cache still
 * answers.
 *
 * WHERE THE REGISTRY LIVES. Under the scratch root it protects, not in the
 * OS temp dir. The resource is per worktree, so the set of runs that can
 * collide over it is exactly the set sharing that tree — and agents on
 * this host deliberately run with separate TMP (see the suite lock, whose
 * pidfile is per-TMP and therefore cannot see other blocks at all). Keying
 * the registry to the tree removes that mismatch instead of inheriting it.
 *
 * Every operation is best-effort: a registry that cannot be read or
 * written must never fail a gate, and the sweep treats "cannot read" as
 * "assume something is live" rather than as "nothing is live".
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Registry directory name, directly under the scratch root. */
export const RUNS_DIR = ".runs";

/** How long the sweep protects everything when liveness is UNKNOWABLE. */
export const UNKNOWN_FLOOR_MS = 60 * 60 * 1000;

function runsDirOf(root) {
  return join(root, RUNS_DIR);
}

/**
 * Whether `pid` is a live process.
 *
 * EPERM means the pid exists and belongs to someone else — alive, and the
 * answer that matters, because reading it as dead is what lets a sweep
 * delete a running gate's files.
 */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err !== null && typeof err === "object" && err.code === "EPERM";
  }
}

/**
 * Record this process as a live run over `root`. Returns the unregister
 * function; calling it twice is harmless, and never calling it (a killed
 * gate) is the case the pid check exists to cover.
 */
export function registerRun(root, pid = process.pid) {
  const file = join(runsDirOf(root), `${pid}.json`);
  try {
    mkdirSync(runsDirOf(root), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        pid,
        startedAt: Date.now(),
        flavor: process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain",
        cwd: process.cwd(),
      }),
    );
  } catch {
    return () => {}; // unregistered: the sweep simply will not spare us
  }
  return () => {
    try {
      rmSync(file, { force: true });
    } catch {
      /* a dead-pid record is pruned by the next reader */
    }
  };
}

/**
 * Live runs over `root` other than `selfPid`, newest record first.
 *
 * Returns `null` when the registry cannot be read — which is NOT the same
 * answer as the empty array, and the difference is the whole safety
 * argument: empty means "asked, and nothing is alive" (evict freely),
 * null means "could not ask" (fall back to the clock). Records for dead
 * pids are deleted as they are found, so a crashed gate cleans up on the
 * next sweep rather than accumulating.
 */
export function liveRuns(root, selfPid = process.pid) {
  let names;
  try {
    names = readdirSync(runsDirOf(root));
  } catch (err) {
    // ENOENT is a real answer: nobody has ever registered over this tree.
    if (err !== null && typeof err === "object" && err.code === "ENOENT") return [];
    return null;
  }
  const live = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = join(runsDirOf(root), name);
    let rec;
    try {
      rec = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // a torn or half-written record is not evidence of life
    }
    if (rec === null || typeof rec !== "object") continue;
    if (typeof rec.pid !== "number" || typeof rec.startedAt !== "number") continue;
    if (!pidAlive(rec.pid)) {
      try {
        rmSync(file, { force: true });
      } catch {
        /* someone else is pruning it too */
      }
      continue;
    }
    if (rec.pid === selfPid) continue; // our own workers have not started yet
    live.push(rec);
  }
  return live.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * The mtime below which eviction is safe, derived from LIFE rather than
 * from the clock:
 *
 *   - no live run  -> `null`, no floor at all: the tree is nobody's, and
 *                     an immediate relaunch recovers the whole overage;
 *   - a live run   -> the EARLIEST live start time, which by the argument
 *                     above covers everything any of them may hold;
 *   - unknowable   -> one hour, the old blanket floor, because a registry
 *                     we cannot read is not permission to delete.
 */
export function scratchFloor(root, now = Date.now(), selfPid = process.pid) {
  const live = liveRuns(root, selfPid);
  if (live === null) return now - UNKNOWN_FLOOR_MS;
  if (live.length === 0) return null;
  return Math.min(...live.map((r) => r.startedAt));
}
