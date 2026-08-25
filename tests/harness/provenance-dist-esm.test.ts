/* --provenance-sources reaching a package that publishes TWO build
 * flavors and is imported for its TYPES.
 *
 * Both halves are measured against the shape zapo-js publishes: an
 * "exports" map whose `import` condition points at ./dist/esm/<sub>/…
 * while `require`/`types` point at ./dist/<sub>/…, and consumers that
 * reach the package through `import type` as often as through a value.
 *
 * The three things this pins, in the order they bite:
 *
 *  1. A subpath whose published target sits TWO build segments deep
 *     (dist/esm/util/index.js) must map to its source twin
 *     (src/util/index.ts). Stripping only the leading dist/ segment
 *     leaves src/esm/util/index.js, which exists nowhere, so the whole
 *     package falls to the island for every subpath at once.
 *  2. A package reached only by `import type` must still register. The
 *     bare-import prescan is what decides whether provenance engages at
 *     all, and a type-only edge is still an edge for the type system —
 *     a class field typed from an island package makes the class
 *     uncompilable and every call of its generic methods refuse.
 *  3. The negative, which is the one that matters most: a subpath the
 *     published package exports but the SOURCE TREE DOES NOT HAVE must
 *     map to NOTHING and say so by name. Mapping a module to the wrong
 *     source is silent where a refusal is loud, so every assertion here
 *     names the exact file each specifier resolved to rather than
 *     checking that some mapping happened.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { analyze, compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const manifest = join(fixtureDir, "manifest-dual.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-dist-esm", flavor);

const dualEntry = join(fixtureDir, "cases/dual/main.ts");
const ghostEntry = join(fixtureDir, "cases/dualghost/main.ts");
const typeOnlyEntry = join(fixtureDir, "cases/typeonly/main.ts");
const cascadeEntry = join(fixtureDir, "cases/cascade/main.ts");

/** POSIX spelling of a host path, so an assertion can name a repo tail. */
const slash = (p: string): string => p.split("\\").join("/");

async function nodeOracle(entry: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", entry],
    { encoding: "utf8" },
  );
  return stdout;
}

async function buildAndRun(name: string, entry: string): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${name}.exe` : name);
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend: "c" });
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

describe("provenance: two-flavor dist and type-only edges", () => {
  test("every dist/esm subpath maps, and each one names its source file", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(dualEntry);
    expect(sources.packages).toHaveLength(1);
    const pkg = sources.packages[0]!;
    expect(pkg.name).toBe("dualdist");

    // WHICH file, not "a" file: the root subpath and the two-segment one.
    expect(Object.keys(pkg.entries).sort()).toEqual(["dualdist", "dualdist/util"]);
    expect(slash(pkg.entries["dualdist"]!)).toMatch(/\/attested-src\/dualdist\/src\/index\.ts$/);
    expect(slash(pkg.entries["dualdist/util"]!)).toMatch(
      /\/attested-src\/dualdist\/src\/util\/index\.ts$/,
    );
    // Not the published tree, under any spelling.
    for (const mapped of Object.values(pkg.entries)) {
      expect(slash(mapped)).not.toContain("/node_modules/");
      expect(slash(mapped)).not.toContain("/dist/");
    }
    // Nothing fell back.
    expect(sources.notes).toEqual([]);

    setProvenanceSources(sources);
    const { coverage } = analyze(dualEntry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    // The compiler READ the source twin — the counted-statement table is
    // the receipt, and it must not name the published package at all.
    const files = [...(coverage.statsByFile ?? [])].map(([f]) => slash(f));
    expect(files.some((f) => f.endsWith("/attested-src/dualdist/src/util/index.ts"))).toBe(true);
    expect(files.some((f) => f.includes("/node_modules/dualdist/"))).toBe(false);

    expect(await buildAndRun("dual-static", dualEntry)).toBe(await nodeOracle(dualEntry));
  });

  test("a subpath the source tree does not have refuses by name and maps to nothing", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(ghostEntry);
    expect(sources.packages).toHaveLength(1);
    const pkg = sources.packages[0]!;
    // The root still maps; 'ghost' maps to NOTHING — not to the root's
    // source, not to a sibling subpath's source, not to the dist file.
    expect(Object.keys(pkg.entries)).toEqual(["dualdist"]);
    expect(pkg.entries["dualdist/ghost"]).toBeUndefined();
    // And the miss is loud: one note, naming the specifier.
    const named = sources.notes.filter((n) => n.includes("'dualdist/ghost'"));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain("island path used");
  });

  test("a package reached only by `import type` still registers", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(typeOnlyEntry);
    expect(sources.packages).toHaveLength(1);
    expect(slash(sources.packages[0]!.entries["dualdist"]!)).toMatch(
      /\/attested-src\/dualdist\/src\/index\.ts$/,
    );

    setProvenanceSources(sources);
    const { coverage } = analyze(typeOnlyEntry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    expect(await buildAndRun("typeonly-static", typeOnlyEntry)).toBe(
      await nodeOracle(typeOnlyEntry),
    );
  });

  test("the generic-method cascade behind a type-only subpath import clears", async () => {
    // Armed first: with the flag OFF this program refuses, and the
    // refusals are the cascade's two halves. A probe that cannot show
    // the failure cannot be believed when it shows the fix.
    setProvenanceSources(null);
    const before = analyze(cascadeEntry).coverage;
    expect(before.diagnostics.length).toBeGreaterThan(0);
    const codes = new Set(before.diagnostics.map((d) => d.code));
    expect(codes.has("SC2013")).toBe(true);
    expect(
      before.diagnostics.some(
        (d) => d.code === "SC1090" && d.message.includes("generic method 'commit'"),
      ),
    ).toBe(true);

    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(cascadeEntry);
    expect(slash(sources.packages[0]?.entries["dualdist/util"] ?? "")).toMatch(
      /\/attested-src\/dualdist\/src\/util\/index\.ts$/,
    );
    setProvenanceSources(sources);
    const after = analyze(cascadeEntry).coverage;
    expect(after.preflightFailed).toBe(false);
    expect(after.diagnostics).toHaveLength(0);
    expect(await buildAndRun("cascade-static", cascadeEntry)).toBe(await nodeOracle(cascadeEntry));
  });
});
