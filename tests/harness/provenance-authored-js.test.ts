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
 * The mapping is a WHITELIST, not a boolean: AUTHORED_JS_DEFAULT_PACKAGES
 * names the packages it applies to when the environment says nothing, and
 * SCRIPTC_PROVENANCE_AUTHORED_JS overrides it. All four readings of that
 * variable are covered here, because each one is load-bearing for somebody:
 *
 *   unset            the default whitelist  — what ships
 *   `pkg`            exactly that package   — what a consumer opts into
 *   `1`/`true`/`all` every package          — what existing env templates
 *                                             already say, and must keep
 *                                             meaning
 *   `` (empty)       no package at all      — the way to turn it fully off
 *
 * The fixture package is NOT on the default list, which is what lets the
 * unset case assert that the default is a whitelist and not `all`.
 *
 * The const read is the load-bearing line. When this mapping first landed the
 * twin's module-init function was emitted and never called, so the binary
 * printed `protocol=0` where Node prints `5` and then died dereferencing a
 * table that was never built — a silent wrong answer, not a refusal. Nothing
 * in the suite covered it; this file is that cover.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  AUTHORED_JS_DEFAULT_PACKAGES,
  analyze,
  compile,
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
  authored: process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"],
};
const restore = (k: string, v: string | undefined): void => {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

afterEach(() => {
  setProvenanceSources(null);
  restore("SCRIPTC_PROVENANCE_MANIFEST", PRIOR.manifest);
  restore("SCRIPTC_PROVENANCE_AUTHORED_JS", PRIOR.authored);
});

describe("provenance: a package that publishes the source it authored", () => {
  test("a package NOT on the list islands, and the note names it", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    /* Explicit, not assumed: this asserts the SHIPPED DEFAULT, so it must hold
     * even when the caller ran the whole suite with the variable set. Unset is
     * the default whitelist, and `authoredjs` is not on it. */
    delete process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"];
    const sources = await resolveProvenanceSources(entry);
    /* Not "no packages resolved" — the tree WAS located and fetched. What is
     * absent is a mapping from the published target to a source file. */
    expect(sources.packages).toHaveLength(0);
    expect(sources.notes.join("\n")).toContain(
      "no source mapping for 'authoredjs' (published target: index.js)",
    );
    setProvenanceSources(sources);
    /* And the island answer is the RIGHT answer, so the gate's default is a
     * refusal to compile statically, never a wrong number. */
    expect(await buildAndRun("authoredjs-island", true)).toBe(EXPECTED);
  });

  test("named on the list, the package maps to its declaration half", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "authoredjs";
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

  test("named on the list, the mapped package compiles STATIC with no blockers", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "authoredjs";
    setProvenanceSources(await resolveProvenanceSources(entry));
    const { coverage } = analyze(entry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
  });

  test("the static binary matches Node, const read included", async () => {
    /* The island build first, so the two binaries are compared to each other
     * as well as to the recorded string. */
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    delete process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"];
    const island = await buildAndRun("authoredjs-island2", true);
    expect(island).toBe(EXPECTED);

    setProvenanceSources(null);
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "authoredjs";
    setProvenanceSources(await resolveProvenanceSources(entry));
    /* dynamic: false — the embedded engine is NOT in this binary, so every
     * value read below came out of the compiled twin. `protocol=5` is the
     * assertion the module-init edge has to earn. */
    const fromSource = await buildAndRun("authoredjs-static", false);
    expect(fromSource).toBe(island);
    expect(fromSource).toBe(EXPECTED);
  });

  /* The four readings of the variable, asserted on the MAPPING rather than on
   * a build, so they are cheap enough to all be here. `authoredjs` is not on
   * the default list, so `mapped` is a direct read of what the variable did. */
  const mapped = async (): Promise<boolean> => {
    const sources = await resolveProvenanceSources(entry);
    return sources.packages.some((p) => p.name === "authoredjs");
  };

  test("the default list is DATA, and it names the package wam needs", () => {
    /* If this constant ever changes, the change is the review. It is the whole
     * blast radius of the shipped default. */
    expect([...AUTHORED_JS_DEFAULT_PACKAGES]).toStrictEqual(["@vinikjkkj/wa-wam"]);
    expect(AUTHORED_JS_DEFAULT_PACKAGES).not.toContain("authoredjs");
  });

  test("unset means the DEFAULT LIST, not all", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    delete process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"];
    expect(await mapped()).toBe(false);
  });

  test("an explicit list of one maps exactly that package", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "authoredjs";
    expect(await mapped()).toBe(true);
    /* A list that names somebody ELSE must not carry this package in with it. */
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "@vinikjkkj/wa-wam,some-other-pkg";
    setProvenanceSources(null);
    expect(await mapped()).toBe(false);
  });

  test("`1` still means ALL, which is what existing env templates say", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    for (const spelling of ["1", "true", "all", "ALL"]) {
      process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = spelling;
      setProvenanceSources(null);
      expect(await mapped(), "spelling " + spelling).toBe(true);
    }
    /* PRECEDENCE: a value that looks like both spellings resolves to ALL, and
     * `1` is never read as the name of a package called `1`. */
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "1,some-other-pkg";
    setProvenanceSources(null);
    expect(await mapped()).toBe(true);
  });

  test("empty means NO package, which is how to turn the lane fully off", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "";
    expect(await mapped()).toBe(false);
    /* Whitespace-only is the same statement, not a package named ' '. */
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "  ,  ";
    setProvenanceSources(null);
    expect(await mapped()).toBe(false);
  });
});
