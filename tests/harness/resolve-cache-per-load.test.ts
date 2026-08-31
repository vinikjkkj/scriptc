/* A SECOND in-process compile must not answer out of the FIRST one's realm.
 *
 * resolve.ts memoizes package.json contents (pkgJsonCache) and workspace
 * member tables (workspaceMembersCache); npm.ts memoizes the resolvable-root
 * set (resolvableRootsMemo). Every one of those is derived from package.json
 * bytes on disk -- one COMPILE's view of the filesystem, not a fact about a
 * path -- and clearResolveCaches() said exactly that in its own comment
 * while being called from two unit tests and nowhere else. loadProgram now
 * clears all three. Upstream vercel-labs/scriptc #206 (27729aa2).
 *
 * WHY A TEST AND NOT A CORPUS ENTRY. Nothing a corpus program can express
 * reaches this: the corpus runs one compile per program and the CLI runs one
 * compile per process. Only programmatic callers, a watch loop, and this
 * harness itself compile twice in one process, which is why the defect
 * survived. The FIXTURE is the second compile.
 *
 * WHY THREE COMPILES AND NOT TWO. A stale cache pins the FIRST answer, so a
 * two-step a-then-b test could be satisfied by a cache that happened to be
 * cold; going a -> b -> a means every step after the first contradicts what
 * a stale cache would hold, in both directions. Deliberately NOT a
 * child-process control: a child would have to import dist while vitest
 * aliases @scriptc/compiler to src, so the control would measure a different
 * build than the assertion it controls for.
 *
 * WHAT IT LOOKED LIKE UNFIXED. Not a resolution failure -- the stale
 * "imports" map made the entry's import resolve to a module whose binding
 * the lowering then blamed:
 *
 *   SC1090 the reference to 'v' (a binding form with no lowering) is not
 *          supported yet
 *
 * A test asserting only "the second compile fails" would have passed for
 * the wrong reason, so this asserts the VALUE the binary prints.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const root = mkdtempSync(join(tmpdir(), "scriptc-realm-"));
const proj = join(root, "proj");

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Writes the project with `#dep` pointing at one of its two modules. The
 * two export the SAME shape, so nothing but the resolution decides the
 * answer -- an entry that failed to typecheck would prove nothing here. */
function seed(depFile: "a.ts" | "b.ts"): void {
  mkdirSync(proj, { recursive: true });
  writeFileSync(
    join(proj, "package.json"),
    JSON.stringify({ name: "realm-probe", type: "module", imports: { "#dep": `./${depFile}` } }, null, 2),
  );
  writeFileSync(join(proj, "a.ts"), 'export const v = "A";\n');
  writeFileSync(join(proj, "b.ts"), 'export const v = "B";\n');
  writeFileSync(join(proj, "main.ts"), 'import { v } from "#dep";\nconsole.log(v);\n');
}

/** Compiles the entry into its OWN output directory (never a shared name --
 * a sibling suite's binary must not be the thing this runs) and runs it.
 * Returns the diagnostics instead of the output when the compile refuses,
 * so a failure names WHAT refused rather than an empty stdout. */
async function buildAndRun(tag: string): Promise<string> {
  const outDir = join(root, `out-${tag}`);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, exeName(`realm-${tag}`));
  const res = await compile(join(proj, "main.ts"), { outPath, outDir });
  if (!res.ok) return `REFUSED ${res.diagnostics.map((d) => `${d.code}: ${d.message}`).join(" | ")}`;
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout.trim();
}

describe("resolution memos are per-load", () => {
  test("a rewritten 'imports' map is honoured by every later compile in the same process", async () => {
    seed("a.ts");
    expect(await buildAndRun("1")).toBe("A");
    // Same entry, same process, different package.json: a watch loop's
    // second pass, and a programmatic caller's second project.
    seed("b.ts");
    expect(await buildAndRun("2")).toBe("B");
    // ...and back, so no single stale answer can satisfy the whole test.
    seed("a.ts");
    expect(await buildAndRun("3")).toBe("A");
  }, 300_000);
});
