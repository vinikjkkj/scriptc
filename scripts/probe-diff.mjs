/* Ad-hoc differential probe: run ONE program under the node oracle and under
 * scriptc on BOTH backends, compare stdout/stderr/exit byte-exactly.
 *
 * Usage: node scripts/probe-diff.mjs <file.ts> [more.ts ...]
 * Scores MATCH / WRONG / TRAP / DID-NOT-RUN per backend.
 * DID-NOT-RUN = the compile refused (diagnostics), so nothing executed.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { compile } from "../packages/compiler/dist/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-probe");
const EXE = process.platform === "win32" ? ".exe" : "";
const comptimeShim = pathToFileURL(join(repoRoot, "tests/harness/comptime-shim.mjs")).href;
const islandShim = pathToFileURL(join(repoRoot, "tests/harness/island-shim.mjs")).href;

async function run(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      encoding: "buffer", maxBuffer: 64 << 20, timeout: 120_000, ...opts,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (e) {
    if (typeof e.code !== "number" || !Buffer.isBuffer(e.stdout)) {
      return { stdout: Buffer.alloc(0), stderr: Buffer.from(String(e.message ?? e)), exitCode: -1 };
    }
    return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code };
  }
}

function show(buf) {
  const s = buf.toString("utf8");
  return s.length > 4000 ? s.slice(0, 4000) + "\n...[truncated]" : s;
}

for (const rel of process.argv.slice(2)) {
  const file = resolve(rel);
  console.log("=".repeat(72));
  console.log("PROGRAM:", file);
  const node = await run(process.execPath, ["--import", comptimeShim, "--import", islandShim, file]);
  console.log("-- node oracle -- exit", node.exitCode);
  console.log("stdout:\n" + show(node.stdout));
  if (node.stderr.length) console.log("stderr:\n" + show(node.stderr));

  for (const backend of ["c", "llvm"]) {
    const key = createHash("sha256").update(file).update(readFileSync(file)).update(backend)
      .update(String(Date.now())).digest("hex").slice(0, 16);
    const outDir = join(cacheDir, key);
    mkdirSync(outDir, { recursive: true });
    let res;
    try {
      res = await compile(file, { outPath: join(outDir, `p-${backend}${EXE}`), outDir, backend });
    } catch (e) {
      console.log(`-- ${backend} -- COMPILE THREW: ${e && e.stack ? e.stack.split("\n").slice(0, 6).join("\n") : e}`);
      console.log(`SCORE[${backend}]: DID-NOT-RUN (ICE)`);
      continue;
    }
    if (!res.ok) {
      console.log(`-- ${backend} -- REFUSED`);
      for (const d of res.diagnostics) console.log(`  [${d.code}] ${d.message}`);
      console.log(`SCORE[${backend}]: DID-NOT-RUN (refused)`);
      continue;
    }
    const got = await run(join(outDir, `p-${backend}${EXE}`), []);
    const outMatch = got.stdout.equals(node.stdout);
    const errMatch = node.exitCode === 0 ? got.stderr.equals(node.stderr) : true;
    const codeMatch = got.exitCode === node.exitCode;
    console.log(`-- ${backend} -- exit ${got.exitCode}`);
    if (!outMatch) console.log("stdout:\n" + show(got.stdout));
    if (!errMatch || got.stderr.length) console.log("stderr:\n" + show(got.stderr));
    const score = outMatch && errMatch && codeMatch ? "MATCH" : "WRONG";
    console.log(`SCORE[${backend}]: ${score}${outMatch ? "" : " (stdout)"}${errMatch ? "" : " (stderr)"}${codeMatch ? "" : " (exit)"}`);
  }
}
