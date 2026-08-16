/* The corpus and the target are not in the same declaration world.
 *
 * frontend/program.ts consults the project's real @types/node only when the
 * entry has a tsconfig.json above it. tests/corpus has none, so 1407 of the
 * 1410 corpus programs compile against the shipped fallback declarations
 * (packages/compiler/ambient/scriptc-node-fallback.d.ts) -- while every real
 * project, zapo included, compiles against @types/node. A corpus fixture
 * therefore pins its behaviour in the world the target is not in.
 *
 * A full-corpus sweep of both worlds measured the size of that gap: of the
 * 1405 corpus programs the frontend reports clean under the fallback, 53
 * change verdict under @types/node 24.13.3, all green-to-red. Two modes:
 * a real tsc type error the fallback's looser declaration hides, and a real
 * LOWERING FENCE -- a capability the corpus says we have and the target's
 * world says we do not.
 *
 * This test is the standing instrument for that gap. It does NOT flip the
 * corpus into the real-types world: the fallback is a shipped surface (every
 * project without @types/node gets it) and must keep being tested, and 34 of
 * the 53 are deliberately ill-typed runtime fixtures whose point is a
 * behaviour, not typecheckability. Instead it re-derives the divergence for
 * the manifest's own programs and fails when the set moves in either
 * direction:
 *
 *   - a listed program that stops diverging (a fence closed, a declaration
 *     fixed) fails here until it is removed from the manifest -- so closing
 *     one of these is recorded rather than silently absorbed;
 *   - a listed program whose CODES change fails here -- so a fence that
 *     merely moves is not mistaken for one that closed.
 *
 * The real-types world is the vendored, pinned tests/fixtures/node-types
 * project (see its README: @types/node 24.13.3, undici-types 7.18.2,
 * committed test data). Each program is copied into a scratch subdirectory
 * of it, so the fixture's tsconfig.json and node_modules resolve by the
 * normal walk-up -- exactly the resolution a real project gets.
 *
 * The FULL 1410-program sweep is not run here (about three minutes per arm).
 * It lives in the block report at G:/zapo-work/estado-realtypes.md; run it
 * when a change could move the two worlds apart rather than together.
 */
import { execFile } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { analyze, compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";
import manifest from "./node-types-divergence.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const sanitize = process.env["SCRIPTC_SAN"] === "1";

const repoRoot = join(import.meta.dirname, "../..");
const corpus = join(repoRoot, "tests/corpus");
const nodeTypesDir = join(repoRoot, "tests/fixtures/node-types");
/* A scratch subdirectory of the fixture: the fixture's tsconfig.json and
 * node_modules/@types/node sit one level up, which is where the resolver
 * looks. Kept out of git by tests/fixtures/node-types/.gitignore. */
const scratch = join(nodeTypesDir, ".divergence");

interface Entry {
  readonly name: string;
  readonly mode: "TYPE" | "FENCE";
  readonly codes: readonly string[];
}
const entries = manifest.programs as readonly Entry[];

/* The accounting assertion: an instrument that can report a beautiful zero
 * because it measured nothing is worse than no instrument. */
test("node-types divergence: the manifest is not empty and names real corpus programs", () => {
  expect(entries.length).toBeGreaterThan(0);
  for (const e of entries) {
    expect(existsSync(join(corpus, e.name)), `${e.name} is not in tests/corpus`).toBe(true);
    expect(e.codes.length).toBeGreaterThan(0);
  }
  expect(new Set(entries.map((e) => e.name)).size).toBe(entries.length);
});

/* Only single-FILE programs are re-derived: a directory program carries
 * siblings whose relative imports the copy would have to reproduce, and no
 * directory program is in the manifest today. The count is asserted so a
 * future directory entry fails here instead of being skipped in silence. */
const singleFile = entries.filter((e) => !e.name.includes("/"));

test("node-types divergence: every manifest program is single-file", () => {
  expect(singleFile.length).toBe(entries.length);
});

test("node-types divergence: each listed program still diverges, with the recorded codes", () => {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    const moved: string[] = [];
    for (const e of singleFile) {
      const dest = join(scratch, e.name);
      cpSync(join(corpus, e.name), dest);
      const r = analyze(dest.split("\\").join("/"), {});
      const codes = [...new Set((r.coverage.diagnostics ?? []).map((d) => d.code))].sort();
      const mode = codes.length === 1 && codes[0] === "SC0001" ? "TYPE" : "FENCE";
      if (codes.length === 0) {
        moved.push(`${e.name}: NO LONGER DIVERGES (was ${e.codes.join(",")}) -- remove it from the manifest`);
      } else if (codes.join(",") !== [...e.codes].sort().join(",") || mode !== e.mode) {
        moved.push(`${e.name}: ${e.mode} ${e.codes.join(",")} -> ${mode} ${codes.join(",")}`);
      }
    }
    expect(moved.join("\n")).toBe("");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 300_000);

/* The capability half. builtin-fn-value.ts is the divergence 2717 could not
 * express, written in the world that has it: `const dh = diffieHellman` at
 * file scope AND inside a function, under real @types/node, where the
 * declaration is an overload set. On base this reports 8 diagnostics
 * (SC2020 x3 + SC2004 x5) and never reaches a binary.
 *
 * Both backends, byte-exact against Node: the C lane and the LLVM lane pick
 * the binding's slot through the same two rules, and a fixture that only ran
 * one of them would not notice a tier that disagrees. */
for (const backend of ["c", "llvm"] as const) {
  test(`node-types: a builtin bound as a value compiles and matches Node (${backend})`, async () => {
    const entry = join(nodeTypesDir, "builtin-fn-value.ts");
    const outDir = mkdtempSync(join(tmpdir(), `scriptc-btnfnval-${backend}-`));
    const result = await compile(entry, {
      outPath: join(outDir, exeName("builtin-fn-value")),
      outDir,
      sanitize,
      backend,
    });
    expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics, null, 2) : "").toBe(true);
    if (!result.ok) return;
    const { stdout } = await execFileAsync(result.binaryPath);
    const { stdout: nodeOut } = await execFileAsync(process.execPath, [entry]);
    expect(stdout).toBe(nodeOut);
  }, 600_000);
}
