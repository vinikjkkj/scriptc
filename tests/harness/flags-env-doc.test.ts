/* docs/flags-and-env.md is the reference for every CLI flag and every environment variable (the tool's, the runtime's, and the runtime's build-time -D
 * knobs). This test keeps it true in BOTH directions:
 *
 *   - every item the code has (see flags-env-inventory.ts for exactly what counts) must be a name in the first cell of a table row of the document,
 *     or the test fails NAMING it;
 *   - every name in a first cell must still exist in the code (or be one of the Node-standard variables the runtime reads), or the test fails naming
 *     the stale entry, so the document cannot rot the other way.
 *
 * THE POSITIVE CONTROLS ARE PART OF THE TEST. A checker that finds nothing is indistinguishable from an extractor that stopped seeing the code, so the
 * last block plants a fake flag in the CLI source text, a fake `process.env` read and a fake `getenv("SCR_FAKE_X")` in a runtime source text, runs the
 * extractors on the planted copies, and requires the document check to report exactly those names missing. It also plants a stale name in a copy of the
 * document and requires the stale check to name it. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildKnobs, cli, cliFromText, envNamesOf, repoRoot, runtimeEnv, runtimeNamesOfText, toolEnv } from "./flags-env-inventory.js";

const docPath = join(repoRoot, "docs/flags-and-env.md");

/** Every backticked name in the first cell of every table row. */
function documentedNames(doc: string): Set<string> {
  const out = new Set<string>();
  for (const line of doc.split("\n")) {
    const m = /^\|\s*([^|]*?)\s*\|/.exec(line);
    if (m === null) continue;
    for (const t of m[1]!.matchAll(/`([^`]+)`/g)) out.add(t[1]!);
  }
  return out;
}

function inventory(): Map<string, string> {
  const want = new Map<string, string>();
  const c = cli();
  for (const f of c.flags) want.set(f.name, "CLI flag");
  for (const s of c.shorts) want.set(s, "CLI short flag");
  for (const k of c.commands) want.set(k, "CLI command");
  for (const e of toolEnv()) want.set(e.name, `environment variable (compiler/CLI/scripts; read in ${e.where[0]})`);
  for (const e of runtimeEnv()) want.set(e.name, `environment variable (runtime; read in ${e.where[0]})`);
  for (const e of buildKnobs()) want.set(e.name, `runtime build-time knob (-D; defined in ${e.where[0]})`);
  return want;
}

/** What the document is missing, as "name (what it is)" lines. */
function missingFrom(want: Map<string, string>, documented: Set<string>): string[] {
  return [...want].filter(([n]) => !documented.has(n)).map(([n, what]) => `${n}: ${what}`);
}

/** Names in the document that the code no longer has. */
function staleIn(want: Map<string, string>, documented: Set<string>): string[] {
  return [...documented].filter((n) => !want.has(n)).sort();
}

describe("flags-and-env.md against the source", () => {
  const doc = readFileSync(docPath, "utf8");
  const documented = documentedNames(doc);
  const want = inventory();

  test("the extractor sees a believable inventory (a floor, so an extractor that goes blind fails here)", () => {
    expect(want.size).toBeGreaterThan(400);
    for (const must of ["--backend", "--sanitize", "--pgo-run", "--no-keep-c", "build", "SCRIPTC_CC", "SCRIPTC_CACHE_DIR", "SCR_CYCLE_THRESHOLD", "SCR_STRING_INTERN", "TZ"]) {
      expect(want.has(must), `${must} should be in the inventory`).toBe(true);
    }
  });

  test("every flag, command, environment variable and build knob of the code is documented", () => {
    const missing = missingFrom(want, documented);
    expect(missing, `docs/flags-and-env.md has no row for:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  test("every documented name still exists in the code", () => {
    const stale = staleIn(want, documented);
    expect(stale, `docs/flags-and-env.md documents names the code no longer has:\n  ${stale.join("\n  ")}`).toEqual([]);
  });
});

describe("the checks fail when they should (planted controls)", () => {
  const doc = readFileSync(docPath, "utf8");
  const documented = documentedNames(doc);

  test("a planted CLI flag is found by the extractor and reported missing", () => {
    const text = readFileSync(join(repoRoot, "packages/cli/src/main.ts"), "utf8");
    const planted = text.replace("  dynamic: { type: \"boolean\", default: false },", "  dynamic: { type: \"boolean\", default: false },\n  \"fake-flag\": { type: \"boolean\", default: false },");
    expect(planted).not.toBe(text);
    const names = new Set(cliFromText(planted).flags.map((f) => f.name));
    expect(names.has("--fake-flag")).toBe(true);
    const want = new Map([...names].map((n) => [n, "CLI flag"] as const));
    const missing = missingFrom(want, documented);
    expect(missing.map((m) => m.split(":")[0])).toEqual(["--fake-flag"]);
  });

  test("a planted process.env read is found by the tool-env extractor and reported missing", () => {
    const into = new Map<string, Set<string>>();
    envNamesOf('const x = process.env["SCRIPTC_FAKE_ENV"]; const y = process.env.SCRIPTC_FAKE_ENV_TWO; const { SCRIPTC_FAKE_ENV_THREE } = process.env;', "planted.ts", into);
    expect([...into.keys()].sort()).toEqual(["SCRIPTC_FAKE_ENV", "SCRIPTC_FAKE_ENV_THREE", "SCRIPTC_FAKE_ENV_TWO"]);
    const want = new Map([...into.keys()].map((n) => [n, "environment variable"] as const));
    expect(missingFrom(want, documented).map((m) => m.split(":")[0]).sort()).toEqual(["SCRIPTC_FAKE_ENV", "SCRIPTC_FAKE_ENV_THREE", "SCRIPTC_FAKE_ENV_TWO"]);
  });

  test("a planted getenv(\"SCR_FAKE_X\") and a helper-wrapped read are found in runtime C text and reported missing", () => {
    const real = readFileSync(join(repoRoot, "packages/runtime/src/scr_string.c"), "utf8");
    const planted = real + '\nstatic int fake(void) { return getenv("SCR_FAKE_X") != 0 || scr_str_env_flag("SCR_FAKE_Y", 1); }\n';
    const names = new Set(runtimeNamesOfText(planted));
    expect(names.has("SCR_FAKE_X")).toBe(true);
    expect(names.has("SCR_FAKE_Y")).toBe(true);
    expect(names.has("SCR_STRING_INTERN")).toBe(true); // the real ones are still seen
    const want = new Map([...names].map((n) => [n, "environment variable"] as const));
    const missing = missingFrom(want, documented).map((m) => m.split(":")[0]).sort();
    expect(missing).toEqual(["SCR_FAKE_X", "SCR_FAKE_Y"]);
  });

  test("a stale documented name is reported", () => {
    const stale = documentedNames(doc + "\n| `SCRIPTC_STALE_ENTRY` | compiler | debug/lab | gone | - |\n");
    expect(staleIn(inventory(), stale)).toEqual(["SCRIPTC_STALE_ENTRY"]);
  });
});
