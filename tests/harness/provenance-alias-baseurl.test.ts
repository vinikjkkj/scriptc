/* --provenance-sources reading a package's alias table from a config that
 * is not in the package's own directory.
 *
 * `sourceAliasesOf` collected `baseUrl` and `paths` by walking a tsconfig
 * "extends" chain — correctly — and then resolved the relative `baseUrl`
 * against the PACKAGE directory instead of against the directory of the
 * config file that spelled it. tsc resolves it against the declaring
 * file. The two agree only when the config that carries `baseUrl` sits in
 * the package root, which is exactly the case a single-package repo
 * produces and a monorepo does not: `packages/<pkg>/tsconfig.json` extends
 * `../tsconfig.paths.json`, which says `"baseUrl": ".."` to mean the repo
 * root, and the old reader turned that into `packages/`.
 *
 * The failure mode is what makes it worth pinning rather than just fixing.
 * The table is still BUILT, still has every key, and every target is still
 * an absolute path — it is simply shifted by the depth of the package, so
 * it points at directories that do not exist. Nothing reports a mapping
 * error. What the compiler reports instead is one `Cannot find module
 * '@core'` per alias site, in the mapped package's own source, and since a
 * package whose source does not typecheck exports nothing, every importer
 * of it then reports "has no exported member". The whole program fails
 * preflight and lowers ZERO statements, and none of the diagnostics names
 * the alias table.
 *
 * Measured on zapo's `packages/fake-server/bench/messaging.bench.ts`
 * (`tests/perf/fakebench/`): 357 unique refusal sites over 215 distinct
 * messages before, 146 over 55 after. 163 of the 211 that went away were
 * one message — `Cannot find module '@…'` — over 15 alias roots, and the
 * 34 in the importing package went with them.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { analyze, compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const manifest = join(fixtureDir, "manifest-aliasbase.json");
const collideManifest = join(fixtureDir, "manifest-aliascollide.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-aliasbase", flavor);

const entry = join(fixtureDir, "cases/aliasbase/main.ts");
const collideEntry = join(fixtureDir, "cases/aliascollide/main.ts");

const EXPECTED = "[core-1.0.0:HI]\n";

/** POSIX spelling of a host path, so an assertion can name a repo tail. */
const slash = (p: string): string => p.split("\\").join("/");

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

async function nodeOracle(file: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", file],
    { encoding: "utf8" },
  );
  return stdout;
}

async function buildAndRun(name: string, file: string, backend: "c" | "llvm"): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${name}.exe` : name);
  const result = await compile(file, { outPath, outDir, dynamic: false, backend });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  }
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout;
}

afterEach(() => {
  setProvenanceSources(null);
  delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
});

describe("provenance: a package's alias baseUrl belongs to the config that spells it", () => {
  test("the fixture is the shape this test claims, including the path that must NOT exist", () => {
    // Positive control on the instrument's input. The alias target has to
    // sit at the attested repo's root for the test to mean anything, and
    // the directory the old reader computed has to be absent — otherwise
    // "resolved to the right file" and "resolved to any file at all" are
    // the same assertion.
    for (const rel of [
      "attested-src/aliasmono/src/core/index.ts",
      "attested-src/aliasmono/packages/tsconfig.paths.json",
      "attested-src/aliasmono/packages/aliaspkg/tsconfig.json",
      "attested-src/aliasmono/packages/aliaspkg/src/index.ts",
      "node_modules/aliaspkg/dist/index.js",
    ]) {
      expect(isFile(join(fixtureDir, rel)), rel).toBe(true);
    }
    // What `join(pkgDir, "..")` produced. Nothing may live here.
    for (const rel of [
      "attested-src/aliasmono/packages/src/core/index.ts",
      "attested-src/aliasmono/packages/aliaspkg/src/core/index.ts",
    ]) {
      expect(isFile(join(fixtureDir, rel)), rel).toBe(false);
    }
    // The package directory has no baseUrl of its own: the only one in the
    // chain is the inherited config's, which is the whole point.
    const own = join(fixtureDir, "attested-src/aliasmono/packages/aliaspkg/tsconfig.json");
    expect(isFile(own)).toBe(true);
  });

  test("the refusal this fixes is real with the flag off", () => {
    // Armed. With no provenance sources the same program refuses at the
    // island boundary, so a probe that shows the fix can also show the
    // failure.
    setProvenanceSources(null);
    const before = analyze(entry).coverage;
    expect(before.diagnostics.length).toBeGreaterThan(0);
    expect(before.diagnostics.some((d) => d.code === "SC2013")).toBe(true);
  });

  test("the alias resolves to the repo-root file, and to a file that exists", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(entry);

    const pkg = sources.packages.find((p) => p.name === "aliaspkg");
    expect(pkg, "aliaspkg must be mapped").toBeDefined();

    const aliases = pkg!.aliases ?? {};
    // `aliaspkg2` is the decoy key the collision suite below uses; it is in
    // the same table and must be read here so this assertion stays exact.
    expect(Object.keys(aliases).sort()).toEqual(["@core", "@core/*", "aliaspkg2"]);

    // WHICH file. The bug produced an absolute path one level short, so
    // "is a string" and "is absolute" both passed while it named nothing.
    const core = aliases["@core"]![0]!;
    expect(slash(core)).toMatch(/\/attested-src\/aliasmono\/src\/core\/index\.ts$/);
    expect(slash(core)).not.toContain("/packages/src/");
    expect(isFile(core), core).toBe(true);

    // The wildcard target is a PATTERN, so it cannot be probed as a file —
    // its directory is what has to exist.
    expect(slash(aliases["@core/*"]![0]!)).toMatch(/\/attested-src\/aliasmono\/src\/core\/\*$/);

    // The entry itself still maps to the package's own source, unshifted.
    expect(slash(pkg!.entries["aliaspkg"]!)).toMatch(
      /\/attested-src\/aliasmono\/packages\/aliaspkg\/src\/index\.ts$/,
    );

    // Nothing fell back to the island.
    expect(sources.notes).toEqual([]);
  });

  test("the program lowers, and the alias target is in the counted statements", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(entry);
    setProvenanceSources(sources);

    const { coverage } = analyze(entry);
    // The wall this defect built: preflight failed and the whole program
    // lowered zero statements, with no diagnostic naming the alias table.
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);

    const files = [...(coverage.statsByFile ?? [])].map(([f]) => slash(f));
    expect(files.some((f) => f.endsWith("/attested-src/aliasmono/src/core/index.ts"))).toBe(true);
    expect(
      files.some((f) => f.endsWith("/attested-src/aliasmono/packages/aliaspkg/src/index.ts")),
    ).toBe(true);
    // The published tree is not what got compiled.
    expect(files.some((f) => f.includes("/node_modules/aliaspkg/"))).toBe(false);
  });

  test("the static binary matches Node on both backends", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(entry);
    setProvenanceSources(sources);
    const oracle = await nodeOracle(entry);
    expect(oracle).toBe(EXPECTED);
    expect(await buildAndRun("aliasbase-c", entry, "c")).toBe(oracle);
    expect(await buildAndRun("aliasbase-llvm", entry, "llvm")).toBe(oracle);
  }, 240_000);
});

/* The second half of the same table, and the worse failure of the two.
 *
 * `provenancePaths()` merges every mapped package's alias table into the
 * ONE tsconfig "paths" object a program gets. It ASSIGNED per key, so two
 * packages that spell the same key — which a monorepo's shared config
 * guarantees, since every package in it extends the same paths file — left
 * only the last one mapped, for everybody.
 *
 * That is not a refusal. The two repos here declare `shoutCore` with the
 * same name and the same signature, so the stomped program typechecks,
 * compiles, links and runs. It prints the other checkout's answer. On
 * zapo's bench the same shape resolved 862 sites' worth of
 * `@protocol/*`, `@util/*`, `@transport/*` and `@infra/*` out of
 * zapo-js@1.6.2's commit and into @zapo-js/store-sqlite's, dragging a
 * whole second copy of the client tree into the program, and not one of
 * the 862 diagnostics said the word "alias".
 */
describe("provenance: two mapped packages spelling the same alias key", () => {
  test("the fixture gives the two repos DIFFERENT answers from one signature", () => {
    // Without this the test cannot fail: if both cores returned the same
    // string, resolving to the wrong checkout would be undetectable, which
    // is exactly how this survived. The two files must exist, and the
    // driver must reach both packages.
    for (const rel of [
      "attested-src/aliasmono/src/core/index.ts",
      "attested-src/aliasmono2/src/core/index.ts",
      "attested-src/aliasmono2/packages/aliaspkg2/src/index.ts",
      "node_modules/aliaspkg2/dist/index.js",
    ]) {
      expect(isFile(join(fixtureDir, rel)), rel).toBe(true);
    }
    const a = readFileSync(join(fixtureDir, "attested-src/aliasmono/src/core/index.ts"), "utf8");
    const b = readFileSync(join(fixtureDir, "attested-src/aliasmono2/src/core/index.ts"), "utf8");
    expect(a).toContain("core-1.0.0");
    expect(b).toContain("core-2.0.0");
    expect(a).not.toBe(b);
    // Same exported name, same signature: the wrong answer TYPECHECKS.
    expect(a).toContain("export function shoutCore(s: string): string");
    expect(b).toContain("export function shoutCore(s: string): string");
  });

  test("the key keeps BOTH targets, first-mapped first", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = collideManifest;
    const sources = await resolveProvenanceSources(collideEntry);
    const names = sources.packages.map((p) => p.name);
    expect(names).toEqual(["aliaspkg", "aliaspkg2"]);

    // Each package's own table is still its own — the merge is what was
    // lossy, not the per-package read.
    const one = sources.packages[0]!.aliases!["@core"]![0]!;
    const two = sources.packages[1]!.aliases!["@core"]![0]!;
    expect(slash(one)).toMatch(/\/attested-src\/aliasmono\/src\/core\/index\.ts$/);
    expect(slash(two)).toMatch(/\/attested-src\/aliasmono2\/src\/core\/index\.ts$/);
    expect(one).not.toBe(two);
  });

  test("a package ENTRY beats an alias key that covers the same specifier", async () => {
    // The precondition that makes the baseUrl fix safe, and the reason a
    // previous block reverted the same fix.
    //
    // aliasmono's paths table names `aliaspkg2` -> its own in-tree decoy.
    // aliaspkg2 is ALSO a separately attested package with its own
    // checkout. That is not a contrived shape: zapo's tsconfig spells
    // `"@zapo-js/*": ["packages/*/src"]`, naming its monorepo copies of
    // @zapo-js/store-sqlite and friends, while those packages are attested
    // from other repos at other commits. Fixing baseUrl makes that alias
    // start RESOLVING, so it has to lose to the entry — and losing has to
    // be a property of the code, not of the iteration order it happens to
    // get.
    //
    // Both orderings that deliver it are already in the source and are
    // commented there: provenancePaths() writes the ENTRY table after the
    // alias table, and resolveSpecifier consults provenanceEntryFor before
    // provenanceAliasTargets. Neither was added for this fix.
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = collideManifest;
    const sources = await resolveProvenanceSources(collideEntry);

    const one = sources.packages.find((p) => p.name === "aliaspkg")!;
    // The alias really is there and really does name the decoy: without
    // this the assertion below passes for the wrong reason.
    expect(slash(one.aliases!["aliaspkg2"]![0]!)).toMatch(
      /\/attested-src\/aliasmono\/packages\/aliaspkg2-decoy\/src\/index\.ts$/,
    );
    expect(isFile(one.aliases!["aliaspkg2"]![0]!)).toBe(true);
    // And the decoy would be a WRONG ANSWER, not a refusal: same export
    // name, same signature, different string.
    const decoy = readFileSync(
      join(fixtureDir, "attested-src/aliasmono/packages/aliaspkg2-decoy/src/index.ts"),
      "utf8",
    );
    expect(decoy).toContain("export function twirl(s: string): string");
    expect(decoy).toContain("DECOY");

    setProvenanceSources(sources);
    const { coverage } = analyze(collideEntry);
    expect(coverage.preflightFailed).toBe(false);
    const files = [...(coverage.statsByFile ?? [])].map(([f]) => slash(f));
    expect(files.some((f) => f.endsWith("/attested-src/aliasmono2/packages/aliaspkg2/src/index.ts"))).toBe(true);
    expect(files.some((f) => f.includes("/aliaspkg2-decoy/"))).toBe(false);
  });

  test("the FIRST-mapped package gets its own checkout, and the borrow is announced", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = collideManifest;
    const sources = await resolveProvenanceSources(collideEntry);
    setProvenanceSources(sources);

    const { coverage } = analyze(collideEntry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    const files = [...(coverage.statsByFile ?? [])].map(([f]) => slash(f));

    // What the fix delivers: the package the driver's own imports reached
    // is compiled against ITS OWN checkout.
    expect(files.some((f) => f.endsWith("/attested-src/aliasmono/src/core/index.ts"))).toBe(true);

    // What it does NOT deliver, asserted rather than hoped. tsconfig
    // "paths" is one flat table per program, so `@core` has exactly one
    // answer and aliaspkg2 borrows aliasmono's. This assertion is
    // deliberately the WRONG-ANSWER shape: if someone ever scopes aliases
    // per declaring package, this line fails and they must come here and
    // read why it was written.
    expect(files.some((f) => f.endsWith("/attested-src/aliasmono2/src/core/index.ts"))).toBe(false);

    // Which is why the borrow has to be LOUD. Before this, the same
    // substitution happened with no note, no diagnostic and no mention of
    // the word "alias" anywhere in the build.
    const named = sources.notes.filter((n) => n.includes("'@core'"));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain("different targets");
    expect(named[0]).toContain("aliaspkg2");
    expect(named[0]).toContain("aliaspkg's checkout");
    // ONE note, not one per key: on zapo's bench the per-key form printed
    // 41 lines. And it must not fire for a key that is also a package
    // ENTRY, because there the entry decides and the alias never does —
    // 39 of those 41 were that false alarm.
    expect(sources.notes.filter((n) => n.includes("alias key(s)"))).toHaveLength(1);
    expect(sources.notes.some((n) => n.includes("'aliaspkg2'"))).toBe(false);
  });

  test("the first-mapped package's binary matches Node on both backends", async () => {
    // Only the half the fix makes correct is compiled and compared. The
    // borrowed half is known to diverge from Node and is pinned above by
    // shape, not by output: asserting a wrong string byte-for-byte would
    // make a defect look like a specification.
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(entry);
    setProvenanceSources(sources);
    const oracle = await nodeOracle(entry);
    expect(oracle).toBe(EXPECTED);
    expect(await buildAndRun("aliasfirst-c", entry, "c")).toBe(oracle);
  }, 240_000);
});
