/* Collect the EXACT set of converted coroutine symbols a run produces.
 *
 * WHY THIS EXISTS. The converted set could previously only be SAMPLED: the
 * scratch tree is reclaimed as tests finish, so every reading is a
 * photograph. Three readings of the same command gave 124, 9 and 27 distinct
 * functions. A union of samples is a FLOOR -- a function born and reclaimed
 * between two samples is absent -- and the minimal knob-on gate cannot be
 * built on a floor, because its own rule refuses to report coverage while any
 * converted function is missing. With a floor, something is always missing.
 *
 * WHY NOT JUST KEEP THE C. `SCRIPTC_NO_SCRATCH_SWEEP=1` already disarms the
 * sweep and costs no code. Measured, it is the wrong lever: the emitted C is
 * 8.3 MB of a 3,607 MB scratch tree -- 0.23% -- so it retains gigabytes to
 * collect megabytes, against a tree that already reaches 3.6 GB WHILE being
 * swept. It is also only the bulk reclaimer: twelve test files remove their
 * own mkdtemp directories regardless, so the lever would fail PARTIALLY,
 * which is worse than failing whole -- an incomplete set wearing the
 * appearance of a complete one.
 *
 * WHY A SETUP FILE GATED ON AN ENV VAR. The strongest form of "does not
 * perturb the run" is to be ABSENT, not to be cheap. Unset, vitest never
 * loads this module and no one has to believe a cost estimate. The pattern is
 * phase-collect.ts, loaded only when SCRIPTC_PHASE_LOG names a directory.
 *
 * WHY afterEach. Not a guess: scratch-hooks.ts already reaches scratch from
 * afterEach, and a file's own afterAll runs after all of its afterEach hooks,
 * so the directories are still present here.
 *
 *   SCRIPTC_CORO_SYMS=<dir>   enable; one file per worker pid
 *
 * Union the per-worker files to get the run's set. Exact, not a floor, and
 * with no window.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";

const NL = String.fromCharCode(10);

/* Definitions only. A forward declaration is `void sc_cr_f(ScrCoroBase *);`
 * and names the same symbol, so counting both would not change the SET -- but
 * the brace is required anyway, because a file holding only a declaration
 * must not contribute a symbol it does not define.
 *
 * Written with [(] rather than an escape: escapes crossing a second parse
 * layer were eaten eight times in one day, once planting a control byte into
 * a deliverable. Removing the surface beats getting it right once. */
const DEF = /void[ ]+sc_cr_([A-Za-z0-9_]+)[(]ScrCoroBase[ ]*[*][ ]*[A-Za-z0-9_]+[)][ ]*[{]/g;

export function extractCoroSymbols(cText: string): Set<string> {
  const out = new Set<string>();
  DEF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEF.exec(cText)) !== null) out.add(m[1]!);
  return out;
}

const dir = process.env["SCRIPTC_CORO_SYMS"];
if (dir !== undefined && dir !== "") {
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "syms-" + String(process.pid) + ".txt");
  /* Paths already read. The walk is incremental: a TU is read once, ever,
   * and a reclaimed directory simply stops appearing. */
  const seen = new Set<string>();
  const root = tmpdir();

  const walk = (d: string, depth: number): string[] => {
    if (depth > 6) return [];
    let ents: import("node:fs").Dirent[] = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return []; }
    const found: string[] = [];
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) found.push(...walk(p, depth + 1));
      else if (e.name.endsWith(".c")) found.push(p);
    }
    return found;
  };

  afterEach(() => {
    /* Only scratch this suite made: the roots the harness mkdtemps under. */
    let roots: string[] = [];
    try {
      roots = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith("scriptc-"))
        .map((e) => join(root, e.name));
    } catch { return; }
    const fresh: string[] = [];
    for (const r of roots) for (const f of walk(r, 0)) if (!seen.has(f)) fresh.push(f);
    if (fresh.length === 0) return;
    const names = new Set<string>();
    for (const f of fresh) {
      seen.add(f);
      let t = "";
      try { t = readFileSync(f, "latin1"); } catch { continue; }
      if (!t.includes("sc_cr_")) continue;
      for (const n of extractCoroSymbols(t)) names.add(n);
    }
    if (names.size > 0) appendFileSync(out, [...names].join(NL) + NL);
  });
}
