/* --provenance-sources reaching a subpath NOBODY IN THE DRIVER NAMES.
 *
 * `resolveProvenanceSources` built each package's specifier→source table
 * exactly once, from the specifiers known at the moment that package was
 * first processed, and never revisited it: `mapOne` returned early on
 * `processed.has(name)` and `enqueue` handed back only NEW package NAMES,
 * so a new SUBPATH of a package already mapped was invisible forever.
 *
 * The consequence is the one that makes it worth a test: the same
 * specifier resolved or refused depending on which file the compiler was
 * pointed at. `spoke` imports `hub/util`; if the driver also imports
 * `hub/util` directly it maps, and if it does not, it never maps — same
 * package, same published target, same source tree.
 *
 * Three things are pinned here, in the order they bite:
 *
 *  1. A subpath first seen inside a transitively-mapped tree maps to its
 *     own source twin, named file by file.
 *  2. It is a FIXED POINT and not a second visit. `hub/deep` is reached
 *     from `spoke/extra`, which is reached from `hub/util`, which is
 *     reached from `spoke` — hub and spoke each have to be re-entered
 *     twice, and one extra revisit apiece is not enough.
 *  3. The negative, which is the half that matters: a subpath the
 *     published package exports but the SOURCE TREE DOES NOT HAVE must
 *     map to NOTHING and say so by name, even when it is discovered
 *     transitively in the same round as a sibling that does map.
 *     Resolving a late-discovered specifier to the wrong source file is
 *     silent where the island refusal is loud.
 */
import { execFile } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { analyze, compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const manifest = join(fixtureDir, "manifest-transitive.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-transitive", flavor);

const transEntry = join(fixtureDir, "cases/transitive/main.ts");
const ghostEntry = join(fixtureDir, "cases/transghost/main.ts");

const EXPECTED = "hub-3.0.0\n[HI-deep4]\n";

/** POSIX spelling of a host path, so an assertion can name a repo tail. */
const slash = (p: string): string => p.split("\\").join("/");

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

async function nodeOracle(entry: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", entry],
    { encoding: "utf8" },
  );
  return stdout;
}

async function buildAndRun(name: string, entry: string, backend: "c" | "llvm"): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${name}.exe` : name);
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
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

describe("provenance: a subpath discovered inside another package's source", () => {
  test("the fixture itself is the shape this test claims", () => {
    // A positive control on the instrument's INPUT. Every assertion below
    // is about which file a specifier resolved to, so the files that must
    // exist and the one that must not are checked here first — otherwise
    // "mapped to nothing" is indistinguishable from a fixture that lost a
    // directory.
    for (const rel of [
      "attested-src/hub/src/index.ts",
      "attested-src/hub/src/util/index.ts",
      "attested-src/hub/src/deep/index.ts",
      "attested-src/spoke/src/index.ts",
      "attested-src/spoke/src/extra/index.ts",
      "attested-src/ghosty/src/index.ts",
      "node_modules/hub/dist/ghost/index.js",
    ]) {
      expect(isFile(join(fixtureDir, rel)), rel).toBe(true);
    }
    // The trap: published, but no twin anywhere in the attested tree.
    for (const rel of [
      "attested-src/hub/src/ghost/index.ts",
      "attested-src/hub/src/ghost.ts",
      "attested-src/hub/ghost/index.ts",
    ]) {
      expect(isFile(join(fixtureDir, rel)), rel).toBe(false);
    }
    // And the driver names neither of the subpaths under test.
    const src = statSync(transEntry).size;
    expect(src).toBeGreaterThan(0);
  });

  test("the refusal this fixes is real with the flag off", () => {
    // Armed: with no provenance sources the same program refuses, and it
    // refuses at the island boundary. A probe that cannot show the
    // failure cannot be believed when it shows the fix.
    setProvenanceSources(null);
    const before = analyze(transEntry).coverage;
    expect(before.diagnostics.length).toBeGreaterThan(0);
    expect(before.diagnostics.some((d) => d.code === "SC2013")).toBe(true);
  });

  test("every subpath maps to its own source file, and each one is named", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(transEntry);

    const byName = new Map(sources.packages.map((p) => [p.name, p]));
    expect([...byName.keys()].sort()).toEqual(["hub", "spoke"]);

    const hub = byName.get("hub")!;
    const spoke = byName.get("spoke")!;

    // WHICH file, not "a" file. `hub` is the only hub specifier the
    // driver names; the other two arrive from spoke's source and from
    // spoke/extra's source respectively.
    expect(Object.keys(hub.entries).sort()).toEqual(["hub", "hub/deep", "hub/util"]);
    expect(slash(hub.entries["hub"]!)).toMatch(/\/attested-src\/hub\/src\/index\.ts$/);
    expect(slash(hub.entries["hub/util"]!)).toMatch(/\/attested-src\/hub\/src\/util\/index\.ts$/);
    expect(slash(hub.entries["hub/deep"]!)).toMatch(/\/attested-src\/hub\/src\/deep\/index\.ts$/);

    expect(Object.keys(spoke.entries).sort()).toEqual(["spoke", "spoke/extra"]);
    expect(slash(spoke.entries["spoke"]!)).toMatch(/\/attested-src\/spoke\/src\/index\.ts$/);
    expect(slash(spoke.entries["spoke/extra"]!)).toMatch(
      /\/attested-src\/spoke\/src\/extra\/index\.ts$/,
    );

    // No specifier resolved to a file that does not exist, none to the
    // published tree under any spelling, and no two specifiers to the
    // same file.
    const mapped: string[] = [];
    for (const pkg of sources.packages) {
      for (const [spec, file] of Object.entries(pkg.entries)) {
        expect(isFile(file), `${spec} -> ${file}`).toBe(true);
        expect(slash(file)).not.toContain("/node_modules/");
        expect(slash(file)).not.toContain("/dist/");
        mapped.push(slash(file));
      }
    }
    expect(mapped).toHaveLength(5);
    expect(new Set(mapped).size).toBe(5);

    // Nothing fell back.
    expect(sources.notes).toEqual([]);

    setProvenanceSources(sources);
    const { coverage } = analyze(transEntry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    // The compiler READ the late-discovered twins — the counted-statement
    // table is the receipt, and it must not name the published package.
    const files = [...(coverage.statsByFile ?? [])].map(([f]) => slash(f));
    expect(files.some((f) => f.endsWith("/attested-src/hub/src/util/index.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("/attested-src/hub/src/deep/index.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("/attested-src/spoke/src/extra/index.ts"))).toBe(true);
    expect(files.some((f) => f.includes("/node_modules/hub/"))).toBe(false);
    expect(files.some((f) => f.includes("/node_modules/spoke/"))).toBe(false);
  });

  test("a transitively-discovered subpath with no twin maps to nothing and says so", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(ghostEntry);
    const hub = sources.packages.find((p) => p.name === "hub")!;

    // The control pair, both discovered inside ghosty's source and both
    // attempted in the same expansion round. One maps; one must not.
    expect(slash(hub.entries["hub/util"]!)).toMatch(/\/attested-src\/hub\/src\/util\/index\.ts$/);
    expect(hub.entries["hub/ghost"]).toBeUndefined();
    // Not to the root's source, not to a sibling subpath's source, not to
    // the published file — to nothing, under any key.
    expect(Object.keys(hub.entries)).not.toContain("hub/ghost");
    for (const file of Object.values(hub.entries)) {
      expect(slash(file)).not.toContain("/ghost");
    }

    // And the miss is loud: one note, naming the specifier.
    const named = sources.notes.filter((n) => n.includes("'hub/ghost'"));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain("island path used");
  });

  test("the static binary matches Node on both backends", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(transEntry);
    setProvenanceSources(sources);
    const oracle = await nodeOracle(transEntry);
    expect(oracle).toBe(EXPECTED);
    expect(await buildAndRun("transitive-c", transEntry, "c")).toBe(oracle);
    expect(await buildAndRun("transitive-llvm", transEntry, "llvm")).toBe(oracle);
  }, 240_000);
});
