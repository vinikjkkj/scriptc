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
 * It is GATED (`SCRIPTC_PROVENANCE_AUTHORED_JS=1`), so this suite runs both
 * sides on purpose:
 *   * with the gate off the package must still island, and the compiler must
 *     say so by name — that is the shipped default, and it stays measured;
 *   * with the gate on the package must map, compile STATIC, and byte-match
 *     the island build of the same published file.
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
import { analyze, compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

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
  test("with the gate OFF the package islands, and the note names it", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    /* Explicit, not assumed: this test asserts the SHIPPED DEFAULT, so it must
     * hold even when the caller ran the whole suite with the gate on. */
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

  test("with the gate ON the package maps to its declaration half", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "1";
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
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "1";
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
    process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "1";
    setProvenanceSources(await resolveProvenanceSources(entry));
    /* dynamic: false — the embedded engine is NOT in this binary, so every
     * value read below came out of the compiled twin. `protocol=5` is the
     * assertion the module-init edge has to earn. */
    const fromSource = await buildAndRun("authoredjs-static", false);
    expect(fromSource).toBe(island);
    expect(fromSource).toBe(EXPECTED);
  });
});
