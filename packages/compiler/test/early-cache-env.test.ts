/* THE EARLY CACHE KEY LEAVES OUT THE C-COMPILER-ONLY VARIABLES, AND ONLY THOSE.
 *
 * The early cache answers before the frontend runs, so its key may contain only what changes lowering or emission. SCRIPTC_PROF_CFLAGS (an extra
 * -D, a -include census header), SCRIPTC_OPT_LEVEL and a few siblings act on clang and the link alone; leaving them in the key made every
 * flag-only variant of a 25-minute lowering miss. This file pins the list from both sides:
 *
 *   - the listed variables do not change the environment digest, any other SCRIPTC_* variable does (the control: SCRIPTC_STABLE_NAMES, which
 *     renames emitted helpers, and SCRIPTC_CC / SCRIPTC_TARGET, which emit-stmts.ts also reads);
 *   - the listed variables really are read only by backend/cc.ts (and named in early-cache.ts): a tripwire that fails the moment any other
 *     module starts to read one, because from then on it can change the emitted program and must be back in the key. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { C_STAGE_ONLY_ENV, scriptcEnvironmentFingerprint } from "../src/frontend/early-cache.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("every C-stage-only variable leaves the digest alone", () => {
  const base = scriptcEnvironmentFingerprint({});
  for (const name of C_STAGE_ONLY_ENV) {
    expect(scriptcEnvironmentFingerprint({ [name]: "x" }), name).toBe(base);
  }
  expect(scriptcEnvironmentFingerprint({ SCRIPTC_PROF_CFLAGS: "-DCFG_PROBE=1 -include /x/census.h" })).toBe(base);
});

test("negative control: variables that reach emission still change the digest", () => {
  const base = scriptcEnvironmentFingerprint({});
  for (const name of ["SCRIPTC_STABLE_NAMES", "SCRIPTC_OWNXFER", "SCRIPTC_SPLIT_PARTS", "SCRIPTC_CC", "SCRIPTC_TARGET", "SCRIPTC_STACKLESS", "SCRIPTC_SOME_FUTURE_KNOB"]) {
    expect(scriptcEnvironmentFingerprint({ [name]: "0" }), name).not.toBe(base);
  }
});

/** The code of a source file with block and line comments removed (crude: enough to tell a reader from a mention in prose). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

test("tripwire: the listed variables are read only by backend/cc.ts (early-cache.ts only names them)", () => {
  const allowed = new Set(["backend/cc.ts", "frontend/early-cache.ts"]);
  for (const name of C_STAGE_ONLY_ENV) {
    const readers = tsFiles(SRC)
      .filter((f) => new RegExp(`\\b${name}\\b`).test(code(readFileSync(f, "utf8"))))
      .map((f) => relative(SRC, f).replaceAll("\\", "/"));
    expect(readers.filter((r) => !allowed.has(r)), `${name} is read outside the C stage`).toEqual([]);
    expect(readers, `${name} has a reader in cc.ts`).toContain("backend/cc.ts");
  }
});
