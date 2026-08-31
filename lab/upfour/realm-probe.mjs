/* Candidate 4 (upstream #206, 27729aa2): does a SECOND in-process compile
 * resolve against the FIRST project's realm?
 *
 * resolve.ts memoizes package.json contents and workspace-member tables in
 * MODULE state. clearResolveCaches() exists and is called from two unit
 * tests and nowhere else -- loadProgram never calls it -- so everything one
 * compile learned about the filesystem is still believed by the next one in
 * the same process.
 *
 * The probe changes what a package.json SAYS between two compiles of the
 * same entry, which is exactly what a watch loop or a programmatic caller
 * does. Argument "one" runs only the second half, as the fresh-process
 * control.
 */
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { compile } from "../../packages/compiler/dist/index.js";

const execFileAsync = promisify(execFile);
const EXE = process.platform === "win32" ? ".exe" : "";
const root = join(process.env["TMP"] ?? ".", "realm-probe");
const proj = join(root, "proj");

function seed(depFile) {
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "package.json"), JSON.stringify({
    name: "realm-probe", type: "module", imports: { "#dep": `./${depFile}` },
  }, null, 2));
  writeFileSync(join(proj, "a.ts"), 'export const v = "A";\n');
  writeFileSync(join(proj, "b.ts"), 'export const v = "B";\n');
  writeFileSync(join(proj, "main.ts"), 'import { v } from "#dep";\nconsole.log(v);\n');
}

async function build(tag) {
  const outDir = join(root, `out-${tag}`);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `p${EXE}`);
  const res = await compile(join(proj, "main.ts"), { outPath, outDir, backend: "c" });
  if (!res.ok) return "REFUSED " + res.diagnostics.map((d) => d.code + ": " + d.message).join(" | ");
  try {
    const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
    return stdout.trim();
  } catch (e) {
    return `RANFAIL ${e.code}`;
  }
}

const only = process.argv[2] === "one";
rmSync(root, { recursive: true, force: true });

if (!only) {
  seed("a.ts");
  console.log("first  (#dep -> a.ts, expect A):", await build("1"));
}
seed("b.ts");
console.log(`${only ? "fresh " : "second"} (#dep -> b.ts, expect B):`, await build("2"));
