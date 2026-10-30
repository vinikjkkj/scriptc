/* --provenance-sources AND --npm-static, on the SAME package. Nothing else in
 * the suite drives that pair, and a whole class of defect lives in it.
 *
 * THE GATE THIS PINS. Implicit-any monomorphization is opt-in per file:
 * lower-calls.ts's `implicitMonoFile` admits a JS source file when
 * `npmStaticPackageOfPath` names the package it belongs to. That predicate
 * answers BY PATH -- the innermost `node_modules/<pkg>/` segment, else a
 * registered workspace realpath (npm-static.ts). It is a proxy for the
 * question the gate actually asks, which is WHOSE JavaScript this is.
 *
 * --provenance-sources breaks the proxy, because the lane's whole job is to
 * change where the bytes are read from. An opted-in package's files arrive
 * from the attested checkout -- `<cache>/<sha>/lib/...` in production, the
 * `attested-src/` tree here -- and that path has no node_modules segment and
 * no workspace registration, so the path-shaped selector answers null for a
 * file that IS the opted-in package's. Measured on mysql2@3.24.5 through a
 * store-mysql driver: the gate read OFF for all 7,729 lowered statements of a
 * package named in --npm-static, and the lane carried 231 more deferred
 * runtime throws than the ordinary --npm-static lane over the same 88 files.
 *
 * WHY NO EXISTING TEST COULD SEE IT, AND WHY THIS FIXTURE IS SHAPED AS IT IS.
 * `implicitMonoFile` starts with `isJsSourceFile`, so a provenance package
 * mapped to TypeScript source can never reach the gate at all. The ONE lane
 * whose provenance-mapped files are JavaScript is the authored-JS mapping
 * (provenance.ts's authoredJsEntry, a structural rule over the mapped tree
 * that names no package): it maps the package to its hand-written
 * `.d.ts` and the declaration-twin machinery pulls the sibling `.js` in as
 * program source. That is the route this file drives, and it is the route the
 * defect was measured on.
 *
 * `authoredjs`, the fixture the sibling suite uses, is deliberately
 * PARAMETERLESS -- its own comment says a parameter "is `unknown` inside the
 * body no matter what the `.d.ts` beside it declares", and records
 * `table[param]` fencing [SC1090] and `switch (param)` fencing [SC1100]. That
 * sentence is true of the lane as built and false as a statement about the
 * lane: monomorphization is exactly the thing that makes such a parameter
 * known, and it was switched off here for a path reason. `monoarg` is
 * `authoredjs` WITH arguments, so the suite can tell those two apart.
 *
 * FOUR ARMS, AND ONLY ONE OF THEM MAY MOVE. The pin is arm A. B, C and D are
 * its controls and read the same on both sides of the gate fix -- B says the
 * gate stays off for a provenance package nobody opted into, C says naming a
 * DIFFERENT package does not switch it on (so the predicate must consult the
 * NAME, not merely that provenance owns the file), and D says the ordinary
 * --npm-static route was never the broken one. A test that asserted only A
 * could not tell "the gate works" from "the gate is on for everything".
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ScrDiagnostic } from "@scriptc/compiler";
import { analyze, compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const entry = join(fixtureDir, "cases/monoarg/main.ts");
const manifest = join(fixtureDir, "manifest-monoarg.json");
const attestedJs = join(fixtureDir, "attested-src/monoarg/index.js");
const installedJs = join(fixtureDir, "node_modules/monoarg/index.js");
/* Suite-flavor segment, for the reason the sibling gives: the plain and
 * SCRIPTC_SAN=1 suites run the same (unsanitized) builds and may run
 * concurrently, so they must never share a build dir. */
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-npm-static-mono", flavor);

/** What Node prints for cases/monoarg/main.ts. The binary owes these bytes. */
const EXPECTED = "wire.private=2\nwire.regular=0\nbucket.realtime=1\nbucket.default=0\n";

const slash = (p: string): string => p.split("\\").join("/");
/** A path as its tail inside tests/fixtures/provenance. The ROUTE is in the
 * first segment -- `attested-src/...` is the provenance copy, a
 * `node_modules/...` key would be the installed one -- so every assertion
 * below that quotes a key is also asserting which copy was compiled. */
const rel = (p: string): string => {
  const s = slash(p);
  const i = s.indexOf(slash(fixtureDir) + "/");
  return i === -1 ? s : s.slice(i + slash(fixtureDir).length + 1);
};

/** SAVED, not deleted: both variables are process-global and this file runs
 * alongside the rest of the suite, so a plain `delete` would clear a gate the
 * caller set for the whole run. Same discipline as the sibling suite. */
const PRIOR = {
  manifest: process.env["SCRIPTC_PROVENANCE_MANIFEST"],
};
const restore = (k: string, v: string | undefined): void => {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

afterEach(() => {
  setProvenanceSources(null);
  restore("SCRIPTC_PROVENANCE_MANIFEST", PRIOR.manifest);
});

/** Installs the authored-JS provenance mapping for `monoarg` and analyzes the
 * entry. `npmStatic` undefined is the flagless lane. */
async function arm(npmStatic?: readonly string[]): Promise<ReturnType<typeof analyze>> {
  process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
  setProvenanceSources(await resolveProvenanceSources(entry));
  return analyze(entry, npmStatic === undefined ? {} : { npmStatic });
}

/** Every refusal as `CODE file:line "construct"`, with the character
 * offset RESOLVED against the source the compiler read. A bare code list would
 * let a fence that moved to another construct keep this green, and the failure
 * message has to name the real thing. */
function fenceSites(r: ReturnType<typeof analyze>): string[] {
  const sites = r.coverage.diagnostics.map((d: ScrDiagnostic) => {
    const text = r.sourceTexts.get(d.loc.file) ?? r.sourceTexts.get(slash(d.loc.file)) ?? "";
    /* An empty text would silently degrade every site to a passing-looking
     * `?:0 ""`. Say so instead of rendering a blank. */
    if (text === "") return d.code + " <NO SOURCE TEXT FOR " + rel(d.loc.file) + ">";
    const line = text.slice(0, d.loc.start).split("\n").length;
    return d.code + " " + rel(d.loc.file) + ":" + String(line) + " " + JSON.stringify(text.slice(d.loc.start, d.loc.end));
  });
  return sites.sort();
}

/** The per-file statement rows as `total/failed/island`, keyed by the path's
 * tail inside the fixture tree. */
function byFile(r: ReturnType<typeof analyze>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [f, s] of r.coverage.statsByFile ?? []) {
    out[rel(f)] = s.total + "/" + s.failed + "/" + s.island;
  }
  return out;
}

/* The mono gate's DECISION, read from its own trace (SCRIPTC_MONO_WHY, printed
 * by implicitMonoFile in lower-calls.ts): one `MONOWHY <verdict> <pkg|-> <file>`
 * per file asked. Fences cannot carry this: dyn lowering closed the one
 * fence the gate-off arms used to produce, so the arms differ only in the
 * decision itself. Returns the decisions for monoarg's index.js (both copies). */
async function gateDecisions<T>(run: () => Promise<T> | T): Promise<{ value: T; monoarg: string[] }> {
  const lines: string[] = [];
  const prior = process.env["SCRIPTC_MONO_WHY"];
  process.env["SCRIPTC_MONO_WHY"] = "1";
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    for (const l of String(chunk).split("\n")) if (l.startsWith("MONOWHY ")) lines.push(l);
    return true;
  });
  try {
    const value = await run();
    return { value, monoarg: lines.filter((l) => /\/monoarg\/index\.js$/.test(l)) };
  } finally {
    spy.mockRestore();
    restore("SCRIPTC_MONO_WHY", prior);
  }
}
/** The gate's decision for every monoarg file, as one verdict. */
const decisionsAre = (lines: string[], verdict: "on" | "off"): boolean =>
  lines.length > 0 &&
  lines.every((l) => (verdict === "on" ? /^MONOWHY (prov-on|path-on) /.test(l) : /^MONOWHY off /.test(l)));

describe("provenance + npm-static: the mono gate answers by package identity", () => {
  test("the route: the lowered file is the ATTESTED copy, byte-identical and node_modules-free", async () => {
    const r = await arm(["monoarg"]);
    const pkgs = r.coverage.provenance?.packages ?? [];
    expect(pkgs.map((p) => p.name)).toEqual(["monoarg"]);
    /* The authored-JS mapping takes the `.d.ts`; the `.js` arrives as its
     * declaration twin. Both halves matter -- the first is why the package
     * maps at all, the second is why there is a JS file in the program to
     * gate. */
    expect(slash(pkgs[0]!.entries["monoarg"]!)).toMatch(/attested-src\/monoarg\/index\.d\.ts$/);

    /* THE MECHANISM, ASSERTED RATHER THAN INTENDED. The file the compiler
     * lowered is the attested one, and no lowered path carries a node_modules
     * segment -- which is exactly why npmStaticPackageOfPath cannot name a
     * package for it. */
    const lowered = [...(r.coverage.statsByFile ?? [])].map(([f]) => slash(f));
    expect(lowered.some((f) => f.endsWith("/attested-src/monoarg/index.js"))).toBe(true);
    expect(lowered.filter((f) => f.includes("/node_modules/monoarg/"))).toEqual([]);
    for (const f of lowered) expect(f).not.toContain("/node_modules/");

    /* And the installed copy is the same bytes, so nothing below can be a
     * source difference wearing a lane difference's clothes. */
    expect(readFileSync(attestedJs).equals(readFileSync(installedJs))).toBe(true);
  });

  /* ARM A -- THE PIN. This is the one that moves. */
  test("A: a package named in --npm-static monomorphizes through the provenance route", async () => {
    const { value: r, monoarg } = await gateDecisions(() => arm(["monoarg"]));
    expect(decisionsAre(monoarg, "on")).toBe(true);
    expect(r.coverage.preflightFailed).toBe(false);
    expect(r.coverage.npmStatic).toEqual([{ package: "monoarg", status: "static" }]);
    expect(r.coverage.diagnostics).toEqual([]);
    /* The gate ON: the parameter is a string inside the body, so neither the
     * record index nor the switch defers anything to run time. */
    expect(fenceSites(r)).toEqual([]);
    /* The FRONTIER, pinned the way the --npm-static suite pins its own. With
     * the gate off index.js lowers 5 statements of which 2 fail; with it on
     * the specialized bodies lower 8 and none fail. The counts are the
     * positive half of the result -- "no fences" on its own is also what a
     * file nobody lowered produces. */
    expect(byFile(r)).toEqual({
      "attested-src/monoarg/index.js": "8/0/0",
      "attested-src/monoarg/index.d.ts": "1/0/0",
      "cases/monoarg/main.ts": "4/0/0",
    });
    expect(r.coverage.stats.statementsFailed).toBe(0);
  });

  /* ARM B -- DEFAULT LANE. The flagless build names every attested package
   * (index.ts: the default posture adds the provenance registry's packages), so
   * the gate is ON for monoarg exactly as in arm A. Scope is still by NAME:
   * arm C below proves an unrelated name does not switch it on for this one. */
  test("B: under the default lane a provenance package is named, and the gate is ON", async () => {
    const { value: r, monoarg } = await gateDecisions(() => arm());
    expect(decisionsAre(monoarg, "on")).toBe(true);
    expect(r.coverage.preflightFailed).toBe(false);
    expect(r.coverage.npmStatic).toEqual([{ package: "monoarg", status: "static" }]);
    expect(r.coverage.diagnostics).toEqual([]);
    expect(fenceSites(r)).toEqual([]);
    expect(byFile(r)["attested-src/monoarg/index.js"]).toBe("8/0/0");
  });

  /* ARM C -- LEAK. The predicate must consult the NAME, not merely that
   * provenance owns the file: a fallback stopping at "provenance knows this
   * file" passes arm A and fails here. */
  test("C: naming a DIFFERENT package does not switch it on for this one", async () => {
    const { value: r, monoarg } = await gateDecisions(() => arm(["some-other-pkg"]));
    expect(decisionsAre(monoarg, "off")).toBe(true);
    expect(r.coverage.npmStatic).toEqual([{ package: "some-other-pkg", status: "static" }]);
    expect(fenceSites(r)).toEqual([]);
    /* Gate off: the same 8 statements as the gate on, none failing. Dyn lowering
     * closed the one statement this used to fail (the table read), so the
     * counts no longer tell the arms apart; the decision above does. */
    expect(byFile(r)["attested-src/monoarg/index.js"]).toBe("8/0/0");
  });

  /* ARM D -- ROUTE. The ordinary --npm-static lane was never the broken one.
   * If this ever fences, the fences above are about implicit-any in general
   * and arm A proves nothing about package identity. */
  test("D: the ordinary --npm-static route (no provenance) was never broken", async () => {
    delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
    setProvenanceSources(null);
    const { value: r, monoarg } = await gateDecisions(() => analyze(entry, { npmStatic: ["monoarg"] }));
    expect(decisionsAre(monoarg, "on")).toBe(true);
    expect(r.coverage.provenance?.packages ?? []).toEqual([]);
    expect(r.coverage.npmStatic).toEqual([{ package: "monoarg", status: "static" }]);
    expect(fenceSites(r)).toEqual([]);
    expect(r.coverage.stats).toEqual({
      statementsTotal: 12,
      statementsFailed: 0,
      statementsIsland: 0,
      functionsSkipped: 0,
    });
  });

  /* The DEFAULT lane binary: no npmStatic option at all, both backends. Node's
   * output is the oracle (the proof of arm B's on-state reaching the binary). */
  for (const backend of ["c", "llvm"] as const) {
    test(`the default-lane static binary runs, and matches Node (${backend})`, async () => {
      process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
      setProvenanceSources(await resolveProvenanceSources(entry));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, exeName(`monoarg-default-${backend}`));
      const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
      if (!result.ok) {
        throw new Error(result.diagnostics.map((d) => d.code + ": " + d.message).join("\n"));
      }
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(EXPECTED);
    });
  }

  /* The binary. With the gate off the same program is REFUSED at build time
   * (arms B and C above: the diagnostics are the refusals), so a coverage hole
   * is a build failure and never a binary that links and then throws. With the
   * gate on it builds, and Node's output is the oracle. */
  test("the static binary runs, and matches Node", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    setProvenanceSources(await resolveProvenanceSources(entry));
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, exeName("monoarg"));
    /* dynamic: false -- the embedded engine is NOT in this binary, so every
     * value printed came out of statically compiled JavaScript. Pinned to the
     * C lane for the reason the sibling pins it: the comparison is about the
     * frontend, never about which backend the build drew. */
    const result = await compile(entry, {
      outPath,
      outDir,
      npmStatic: ["monoarg"],
      dynamic: false,
      backend: "c",
    });
    if (!result.ok) {
      throw new Error(result.diagnostics.map((d) => d.code + ": " + d.message).join("\n"));
    }
    const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
    expect(stdout).toBe(EXPECTED);
  });
});
