/* --provenance-sources (EXPERIMENTAL): the provenance-assisted static
 * compilation pipeline, offline — the fixture manifest
 * (SCRIPTC_PROVENANCE_MANIFEST) stands in for the live attestation +
 * source fetch, so these tests exercise everything AFTER the network:
 * source-entry mapping, the registry chokepoints (preflight edges, tsgo
 * "paths", the npm-import bypass), the @__PURE__ dead-const elision, the
 * per-package attribution, and the island fallback notes.
 *
 * The differential contract is the thesis itself: the binary compiled
 * from the ATTESTED SOURCE (static, no island) must byte-match the
 * binary island-running the PUBLISHED dist — and both must byte-match
 * Node running the published package.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  analyze,
  compile,
  resolveProvenanceSources,
  setProvenanceSources,
} from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const entry = join(fixtureDir, "cases/greet/main.ts");
/* Suite-flavor segment: the plain and SCRIPTC_SAN=1 suites both run these
 * same (unsanitized) builds and may run concurrently — the suite lock is
 * per flavor — so they must never share a build dir. */
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance", flavor);

const EXPECTED = "hello, world\nHELLO, COMPILER!\nhello, chain!\n";

/* The protobuf-intersection case (see the test below). */
const pbEntry = join(fixtureDir, "cases/pb/main.ts");
const PB_EXPECTED =
  "4 4 2 3\n" +
  "123 ping@1:ping mute@2:mute-<chatJid> star@5:star-<remote>-<id> 3literal\n" +
  // The re-export-only generated module (spec/version): the whole line
  // reads storage that only its twin's %init writes. Reaching a declaration
  // file through `export { X } from` and nothing else left that init
  // unscheduled while the read was bound to the twin's global — a NULL
  // dereference with no trap, no code and no location.
  "pbgen-2.0.1 11 65535 5\n" +
  // The CJS-WHOLE-EXPORT generated module (spec/wire): a twin whose last
  // line is `module.exports = <identifier>`, so no export its declaration
  // names has a binding of that name anywhere in it. Before the
  // declaration-twin export bridge this line was zapo's own wall word for
  // word — "'wire.Frame.encode' has no compiled implementation (its module
  // '…/index.d.ts' compiled, but no body for this member lowers out of
  // it)" — with 1.8 MB of compiled twin sitting beside the declaration and
  // nothing able to reach it.
  "f:42 wire-2 6\n" +
  // The same edge in the BUNDLER's spelling (spec/bundle): a merged `var`
  // declarator list whose root the twin keeps as an init LOCAL, and the
  // export parked in a comma operand of the last expression statement.
  // Nothing there has a binding a bridge could root at — not the declared
  // export, not the root — so the bridge reads the declared exports off the
  // module's own export OBJECT, which is the value a requirer gets. This is
  // zapo's `spec/proto/index.js` shape exactly.
  "b#123 bundle-7 8\n";

async function buildAndRun(name: string, dynamic: boolean, from = entry): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  // Windows cannot CreateProcess an extension-less file, so the built
  // binary needs the suffix to be spawnable at all.
  const outPath = join(outDir, process.platform === "win32" ? `${name}.exe` : name);
  // Pinned: the provenance thesis compares a source-static binary against
  // a dist-island binary — holding both on the C lane keeps that byte
  // comparison about PROVENANCE, never about which backend each build drew.
  const result = await compile(from, { outPath, outDir, dynamic, backend: "c" });
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

describe("provenance sources", () => {
  test("attested source compiles STATIC and byte-matches the island's published dist", async () => {
    // Flag off: the published dist embeds in the island (--dynamic).
    const island = await buildAndRun("greet-island", true);
    expect(island).toBe(EXPECTED);

    // Flag on: the manifest maps greeter to its source tree; the driver
    // compiles WITHOUT --dynamic — possible only because the source
    // became program modules (a bare npm import would fence a static
    // build), which IS the assertion that nothing islanded.
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = join(fixtureDir, "manifest.json");
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(1);
    const pkg = sources.packages[0]!;
    expect(pkg.name).toBe("greeter");
    expect(pkg.version).toBe("1.2.3");
    // POSIX spelling: the resolver answers a HOST path (backslashes on
    // win32), while the shape being asserted is the repo-relative tail.
    expect(pkg.entries["greeter"]!.split("\\").join("/")).toMatch(
      /attested-src\/greeter\/src\/index\.ts$/,
    );
    setProvenanceSources(sources);
    const fromSource = await buildAndRun("greet-static", false);
    expect(fromSource).toBe(island);
  });

  test("per-package attribution counts the source static; the @__PURE__ dead const elides", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = join(fixtureDir, "manifest.json");
    setProvenanceSources(await resolveProvenanceSources(entry));
    const { coverage } = analyze(entry);
    expect(coverage.preflightFailed).toBe(false);
    // No blockers anywhere: the dead const elided instead of fencing.
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.provenanceElided ?? []).toHaveLength(1);
    expect(coverage.provenanceElided![0]!.message).toContain("'Legacy'");
    // Attribution: every counted statement of the greeter source is
    // static (the elided declaration never counts — it lowers to nothing).
    const srcStats = [...(coverage.statsByFile ?? [])].filter(([f]) => f.includes("attested-src/greeter/"));
    expect(srcStats.length).toBeGreaterThan(0);
    for (const [, s] of srcStats) {
      expect(s.failed).toBe(0);
      expect(s.island).toBe(0);
    }
  });

  test("a generated .d.ts with a compiled twin flattens its class-intersection", async () => {
    /* A protobufjs-style generated surface: `spec/proto/index.d.ts` beside
     * its real `index.js`, and `decode` returning `Msg & Msg.$Shape` — a
     * declaration-file CLASS intersected with its own $Properties
     * interface. Provenance is the only build shape that produces it: the
     * declaration stays authoritative while its implementation twin joins
     * module order (provenanceDeclSiblings + declTwinOf), which is exactly
     * the combination the class-part rule used to refuse. `Msg` alone
     * mapped to a record and `Msg & Msg.$Shape` mapped to nothing, so the
     * intersection failed every field, record and Promise above it.
     *
     * The intersection here is carried through a field of an async
     * function's Promise payload — the WaPairingFlow shape that exposed it
     * — and read back on the other side.
     *
     * The oracle is NODE over the published dist rather than the island
     * binary the tests above compare against: the island half needs the
     * embedded engine archive, and this assertion is about the STATIC
     * mapping, which is where the refusal lived. */
    const { stdout: oracle } = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", pbEntry],
      { encoding: "utf8" },
    );
    expect(oracle).toBe(PB_EXPECTED);

    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = join(fixtureDir, "manifest-pb.json");
    const sources = await resolveProvenanceSources(pbEntry);
    expect(sources.packages).toHaveLength(1);
    expect(sources.packages[0]!.name).toBe("pbgen");
    setProvenanceSources(sources);
    // No island anywhere, so every value crossing the intersection had to
    // lower statically. A refusal here is the fence coming back.
    const { coverage } = analyze(pbEntry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    const fromSource = await buildAndRun("pb-static", false, pbEntry);
    expect(fromSource).toBe(oracle);
  });

  test("an unmappable package falls back to the island with a note, never a failure", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = join(fixtureDir, "manifest-broken.json");
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(0);
    expect(sources.notes).toHaveLength(1);
    expect(sources.notes[0]).toContain("greeter");
    expect(sources.notes[0]).toContain("island path used");
    setProvenanceSources(sources);
    // The island path still works under the flag — the fallback contract.
    const island = await buildAndRun("greet-fallback", true);
    expect(island).toBe(EXPECTED);
  });
});
