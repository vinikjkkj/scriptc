/* --provenance-sources reaching a package that HAS NO BUILD STEP: what it
 * publishes is what it authored, so the published target (`index.js`) has no
 * `.ts` twin for the source walk to find and the whole package used to fall to
 * the island with a `no source mapping` note, however faithfully its source
 * had been fetched.
 *
 * The mapping that fixes it takes the hand-written `.d.ts` beside the file —
 * mapping the `.js` directly would compile the values and lose the types — and
 * lets the existing declaration-twin machinery supply the bodies.
 *
 * The mapping is a STRUCTURAL RULE over the mapped tree and names no package
 * (there is no list and no environment variable): every TypeScript candidate
 * has missed, and at the mapped location a `.d.ts` exists with its
 * implementation beside it. The rule tests below classify one fixture per
 * SHAPE -- a flat data package, a driver with a subpath `exports` map, a
 * package built from TypeScript, a package with no declaration -- and a source
 * scan proves no package name is left in the compiler's provenance logic.
 *
 * The const read is the load-bearing line. When this mapping first landed the
 * twin's module-init function was emitted and never called, so the binary
 * printed `protocol=0` where Node prints `5` and then died dereferencing a
 * table that was never built — a silent wrong answer, not a refusal. Nothing
 * in the suite covered it; this file is that cover.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  analyze,
  compile,
  ProvenanceRefusalError,
  resolveProvenanceSources,
  setProvenanceSources,
} from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const entry = join(fixtureDir, "cases/authoredjs/main.ts");
const manifest = join(fixtureDir, "manifest-authoredjs.json");
/* Suite-flavor segment: the plain and SCRIPTC_SAN=1 suites run the same
 * (unsanitized) builds and may run concurrently, so they must never share a
 * build dir. */
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-authored", flavor);

const EXPECTED =
  "protocol=5\n" + "wire.regular=0\n" + "wire.private=2\n" + "fn.count=3\n" + "CHAT_OPEN=3\n" + "LT128=3\n";

async function buildAndRun(name: string, dynamic: boolean): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  /* Windows cannot CreateProcess an extension-less file. */
  const outPath = join(outDir, process.platform === "win32" ? `${name}.exe` : name);
  /* Pinned to the C lane for the same reason the sibling suite pins it: the
   * comparison is about provenance, never about which backend each build drew. */
  const result = await compile(entry, { outPath, outDir, dynamic, backend: "c" });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  }
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout;
}

/* SAVED, not deleted. Both variables are process-global and this file runs
 * alongside the rest of the suite; a plain `delete` would silently clear a
 * gate the CALLER set for the whole run, for every file that shares this
 * worker afterwards. Restoring the entry value leaves the process exactly as
 * it was found whichever order the files run in. */
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

describe("provenance: a package that publishes the source it authored", () => {
  test("with NO list anywhere the package maps, and the island build is the control", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages.map((p) => p.name)).toEqual(["authoredjs"]);
    expect(sources.notes.join("\n")).not.toContain("no source mapping for 'authoredjs'");
    /* CONTROL: with no provenance registered the same entry is the island, and
     * the island's answer is the recorded one. */
    setProvenanceSources(null);
    expect(await buildAndRun("authoredjs-island", true)).toBe(EXPECTED);
  });

  test("the package maps to its declaration half", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(1);
    const pkg = sources.packages[0]!;
    expect(pkg.name).toBe("authoredjs");
    expect(pkg.version).toBe("2.0.4");
    /* POSIX spelling: the resolver answers a HOST path (backslashes on win32)
     * while the shape asserted is the repo-relative tail. The `.d.ts`, not the
     * `.js`: taking the implementation directly would drop the types and send
     * any consumer naming one type token back to the island. */
    expect(pkg.entries["authoredjs"]!.split("\\").join("/")).toMatch(
      /attested-src\/authoredjs\/index\.d\.ts$/,
    );
    expect(sources.notes.join("\n")).not.toContain("no source mapping for 'authoredjs'");
  });

  test("the mapped package compiles STATIC with no blockers", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    setProvenanceSources(await resolveProvenanceSources(entry));
    const { coverage } = analyze(entry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
  });

  test("the static binary matches Node, const read included", async () => {
    /* The island build first, so the two binaries are compared to each other
     * as well as to the recorded string. */
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const island = await buildAndRun("authoredjs-island2", true);
    expect(island).toBe(EXPECTED);

    setProvenanceSources(await resolveProvenanceSources(entry));
    /* dynamic: false — the embedded engine is NOT in this binary, so every
     * value read below came out of the compiled twin. `protocol=5` is the
     * assertion the module-init edge has to earn. */
    const fromSource = await buildAndRun("authoredjs-static", false);
    expect(fromSource).toBe(island);
    expect(fromSource).toBe(EXPECTED);
  });

  /* THE RULE, one fixture per shape. Each package is manifest-seeded, so the
   * classification is a property of its TREE and nothing else: no name, no
   * attestation, no environment. */
  const classifyEntry = join(fixtureDir, "cases/classify/main.ts");
  const classifyManifest = join(fixtureDir, "manifest-classify.json");
  const posix = (p: string | undefined): string => (p ?? "<none>").split("\\").join("/");

  test("RULE: classifies a flat data package, a driver with an exports map, a TS-built package, bare JS, and a shim that is not the published file", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = classifyManifest;
    const sources = await resolveProvenanceSources(classifyEntry);
    const byName = new Map(sources.packages.map((p) => [p.name, p]));
    /* wa-wam's shape: flat index.js + hand-written index.d.ts, one script, no exports. */
    expect(posix(byName.get("wamshape")?.entries["wamshape"])).toMatch(/attested-src\/wamshape\/index\.d\.ts$/);
    /* mysql2's shape: an exports map, no `types` field, a subpath. Both the
     * root and `./promise` map to the declaration half. */
    expect(posix(byName.get("mysqlshape")?.entries["mysqlshape"])).toMatch(/attested-src\/mysqlshape\/index\.d\.ts$/);
    expect(posix(byName.get("mysqlshape")?.entries["mysqlshape/promise"])).toMatch(
      /attested-src\/mysqlshape\/promise\.d\.ts$/,
    );
    /* NEGATIVE CONTROL 1: a package built from TypeScript maps to its .ts
     * source, NOT to a declaration: the authored rule only fires when every
     * TypeScript candidate missed. */
    expect(posix(byName.get("greeter")?.entries["greeter"])).toMatch(/attested-src\/greeter\/src\/index\.ts$/);
    /* Authored JS with NO declaration maps to the published file itself, but
     * only in the IDENTITY spelling: the tree holds the file at the very path
     * the package publishes it at. */
    expect(posix(byName.get("jsonly")?.entries["jsonly"])).toMatch(/attested-src\/jsonly\/index\.js$/);
    /* A package whose "main" is spelled WITHOUT an extension ("lib/index", the
     * way Node accepts it) maps to the file Node would load. Base: "no source
     * mapping" and the island. */
    expect(posix(byName.get("extless")?.entries["extless"])).toMatch(/attested-src\/extless\/lib\/index\.js$/);
    /* NEGATIVE CONTROL 2: the package publishes dist/index.js, which is absent
     * from the tree, while an unrelated root index.js IS there. Mapping that
     * shim would compile code the package never ships, so it must not map. */
    expect(byName.has("distjs")).toBe(false);
    expect(sources.notes.join("\n")).toContain("no source mapping for 'distjs' (published target: dist/index.js)");
  });

  test("RULE: bare JavaScript with no declaration compiles STATIC and runs", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = classifyManifest;
    const bareEntry = join(fixtureDir, "cases/barejs/main.ts");
    setProvenanceSources(await resolveProvenanceSources(bareEntry));
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, process.platform === "win32" ? "barejs.exe" : "barejs");
    const result = await compile(bareEntry, { outPath, outDir, dynamic: false, backend: "c" });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
    expect(stdout).toBe("J=1\n");
  });

  test("RULE: no package name is left in the provenance logic (matcher shown firing)", () => {
    /* Comments may cite a package as a measured example; BEHAVIOUR keyed on a
     * name may not. So strip comments, then look for a quoted package name. */
    const codeOf = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const NAMES = /["'`](?:@vinikjkkj\/wa-wam|mysql2|zapo-js|@zapo-js\/[a-z-]+|long|iconv-lite|generate-function)["'`]/;
    /* Positive controls: the matcher fires on the old shape, and on a name
     * that lives only inside a string. */
    expect(NAMES.test(codeOf('export const L: readonly string[] = ["@vinikjkkj/wa-wam", "mysql2"];'))).toBe(true);
    expect(NAMES.test(codeOf('if (pkg === "mysql2") return true; // fine'))).toBe(true);
    /* ... and ignores the same name in a comment. */
    expect(NAMES.test(codeOf('/* e.g. "mysql2" */\n// "@vinikjkkj/wa-wam"\nconst x = 1;'))).toBe(false);
    for (const f of [
      "packages/compiler/src/frontend/provenance.ts",
      "packages/compiler/src/frontend/provenance-lockfile.ts",
      "packages/compiler/src/frontend/provenance-registry.ts",
    ]) {
      const code = codeOf(readFileSync(join(repoRoot, f), "utf8"));
      expect(NAMES.test(code), f).toBe(false);
      expect(code, f).not.toContain("AUTHORED_JS");
    }
  });
});

/* ---------------------------------------------------------------------------
 * A mapped package's OWN dependencies.
 *
 * Every case above maps one package and stops. This one maps a package whose
 * implementation needs a SECOND package, which is where the authored lane and
 * the ordinary lane stop agreeing.
 *
 * Two edges have to exist for the value to arrive, and neither did:
 *
 *   the WALK. Its roots are the files the mapper answered with. For a package
 *   with a build step that file is the TypeScript source, so following its
 *   relative imports finds every dependency. For an authored-JavaScript
 *   package the mapped file is the `.d.ts`, and a declaration file does not
 *   spell what its implementation imports -- so the walk stopped at the
 *   surface and the dependency was never offered to the pipeline. Measured on
 *   mysql2@3.24.5: its mapped `promise.d.ts` reported no external specifiers
 *   at all while `promise.js` required seven installed packages.
 *
 *   the REQUIRE. The bare-IMPORT branch of preflight has consulted
 *   resolveProjectImport since provenance existed; the bare-REQUIRE branch had
 *   not, so the two spellings disagreed about the same specifier in the same
 *   program. An authored-JavaScript package is CommonJS, so the branch that
 *   knew about provenance is the one it never uses.
 *
 * The two tests separate the two edges rather than asserting the pair: with
 * the dependency left out of the manifest it stays unmappable, and the
 * refusal has to read exactly as it did before -- a package that cannot map
 * keeps today's answer, which is what makes the other test's zero a result
 * and not a widening that swallowed everything. */
const depEntry = join(fixtureDir, "cases/authoreddep/main.ts");
const depManifest = join(fixtureDir, "manifest-authoreddep.json");
const depManifestOnly = join(fixtureDir, "manifest-authoreddep-only.json");

describe("provenance: an authored package's own dependency", () => {
  test("a dependency that publishes no attestation and has no lockfile digest REFUSES the build, naming it", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = depManifestOnly;
    /* The registry is stubbed to answer 404 (no attestation) for everything:
     * `depts` is reached only through the authored package's implementation
     * twin, nothing locks it, so its bytes cannot be verified. That is a
     * build-time refusal naming the package, never an island. */
    const realFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (): Promise<unknown> => ({
      status: 404,
      ok: false,
      json: async () => ({}),
    });
    try {
      let refusal: unknown = null;
      try {
        await resolveProvenanceSources(depEntry);
      } catch (e) {
        refusal = e;
      }
      expect(refusal).toBeInstanceOf(ProvenanceRefusalError);
      expect((refusal as ProvenanceRefusalError).refusals.map((r) => r.package)).toContain("depts");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("the walk reaches it through the implementation twin, and require() resolves it", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = depManifest;
    const sources = await resolveProvenanceSources(depEntry);
    /* The dependency is in the graph ONLY through the `.d.ts`'s implementation
     * twin: nothing the entry imports names it, and the declaration does not
     * either. */
    const byName = new Map(sources.packages.map((p) => [p.name, p]));
    expect([...byName.keys()].sort()).toEqual(["authoreddep", "depts"]);
    /* And it maps the ORDINARY way, to its TypeScript source -- the authored
     * rule carries the package that has no build step, not everything it
     * drags in. */
    expect(byName.get("depts")!.entries["depts"]!.split("\\").join("/")).toMatch(
      /attested-src\/depts\/src\/index\.ts$/,
    );
    setProvenanceSources(sources);
    const { coverage } = analyze(depEntry);
    expect(coverage.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  });
});
