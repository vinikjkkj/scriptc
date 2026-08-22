/* run-projection.mjs — compile one entry on both backends, run each, run Node,
 * and diff. Usage: node run-projection.mjs <entry.ts> [--dynamic] */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
/* The repo this script lives in, not the worktree it was written in. An
 * absolute path here silently compiled with ANOTHER tree's dist. */
const repoRootEarly = process.env["PJ_REPO"] ?? resolve(fileURLToPath(import.meta.url), "../../../..");
const { compile } = await import(pathToFileURL(join(repoRootEarly, "packages/compiler/dist/index.js")).href);

const execFileAsync = promisify(execFile);
const repoRoot = repoRootEarly;
const cacheDir = process.env["PJ_CACHE"] ?? join(tmpdir(), "scr-pj-cache");

async function runBinary(cmd, args) {
  const pending = execFileAsync(cmd, args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  pending.child.stdin?.end();
  try {
    const { stdout, stderr } = await pending;
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    if (typeof err.code !== "number") return { stdout: err.stdout ?? Buffer.alloc(0), stderr: Buffer.from(String(err.message)), exitCode: -1 };
    return { stdout: err.stdout, stderr: err.stderr, exitCode: err.code };
  }
}

const entry = resolve(process.argv[2]);
const dynamic = process.argv.includes("--dynamic");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

const src = readFileSync(entry, "utf8");
const wantsTT = /\benum\s+[A-Za-z_$]/.test(src) || /^\/\/ @transform-types/m.test(src);
const nodeArgs = [
  ...(wantsTT ? ["--experimental-transform-types", "--disable-warning=ExperimentalWarning"] : []),
  "--import", pathToFileURL(join(repoRoot, "tests/harness/comptime-shim.mjs")).href,
  "--import", pathToFileURL(join(repoRoot, "tests/harness/island-shim.mjs")).href,
  entry,
];
const node = await runBinary(process.execPath, nodeArgs);
console.log("=== NODE exit=" + node.exitCode);
process.stdout.write(node.stdout);
if (node.stderr.length) process.stderr.write("[node stderr] " + node.stderr.toString());

for (const backend of only ? [only] : ["c", "llvm"]) {
  const key = createHash("sha256").update(entry).update(src).update(backend).update(dynamic ? "d" : "").digest("hex").slice(0, 16);
  const outDir = join(cacheDir, key);
  mkdirSync(outDir, { recursive: true });
  let result;
  try {
    result = await compile(entry, { outPath: join(outDir, "program.exe"), outDir, dynamic, backend });
  } catch (e) {
    console.log(`=== ${backend.toUpperCase()} THREW: ${e && e.message}`);
    continue;
  }
  if (!result.ok) {
    console.log(`=== ${backend.toUpperCase()} REFUSED`);
    for (const d of result.diagnostics) console.log(`  ${d.code}: ${d.message}`);
    continue;
  }
  const r = await runBinary(result.binaryPath, []);
  const same = r.stdout.equals(node.stdout) && r.exitCode === node.exitCode;
  console.log(`=== ${backend.toUpperCase()} exit=${r.exitCode} match=${same ? "EXACT" : "*** DIVERGES ***"}`);
  process.stdout.write(r.stdout);
  if (r.stderr.length) process.stderr.write(`[${backend} stderr] ` + r.stderr.toString());
  if (!same) {
    const a = node.stdout.toString().split("\n");
    const b = r.stdout.toString().split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) console.log(`  line ${i + 1}: node=${JSON.stringify(a[i])} ${backend}=${JSON.stringify(b[i])}`);
    }
  }
}
