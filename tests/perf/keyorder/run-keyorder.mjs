/* run-keyorder.mjs — compile one entry on both backends, run each, run Node,
 * and diff. Usage: node run-keyorder.mjs <entry.ts> [--only=c|llvm] [--dynamic]
 * The Node process IS the oracle; the compiled binaries are the subject. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = process.env["KO_REPO"] ?? resolve(fileURLToPath(import.meta.url), "../../../..");
const cacheDir = process.env["KO_CACHE"] ?? join(tmpdir(), "scr-ko-cache");
const { compile } = await import(pathToFileURL(join(repoRoot, "packages/compiler/dist/index.js")).href);
const execFileAsync = promisify(execFile);

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

export async function nodeOracle(entry) {
  const src = readFileSync(entry, "utf8");
  const wantsTT = /\benum\s+[A-Za-z_$]/.test(src) || /^\/\/ @transform-types/m.test(src);
  const nodeArgs = [
    ...(wantsTT ? ["--experimental-transform-types", "--disable-warning=ExperimentalWarning"] : []),
    "--import", pathToFileURL(join(repoRoot, "tests/harness/comptime-shim.mjs")).href,
    "--import", pathToFileURL(join(repoRoot, "tests/harness/island-shim.mjs")).href,
    entry,
  ];
  return await runBinary(process.execPath, nodeArgs);
}

/** One entry, one backend: REFUSE / THREW / EXACT / DIVERGE, with the lines. */
export async function oneBackend(entry, backend, node, { dynamic = false } = {}) {
  const src = readFileSync(entry, "utf8");
  const key = createHash("sha256").update(entry).update(src).update(backend).update(dynamic ? "d" : "").digest("hex").slice(0, 16);
  const outDir = join(cacheDir, key);
  mkdirSync(outDir, { recursive: true });
  let result;
  try {
    result = await compile(entry, { outPath: join(outDir, "program.exe"), outDir, dynamic, backend });
  } catch (e) {
    return { verdict: "THREW", detail: String(e && e.message) };
  }
  if (!result.ok) {
    return { verdict: "REFUSE", codes: result.diagnostics.map((d) => d.code), diags: result.diagnostics.map((d) => `${d.code}: ${d.message}`) };
  }
  const advis = (result.advisories ?? []).map((d) => `${d.code}: ${d.message}`);
  const r = await runBinary(result.binaryPath, []);
  const same = r.stdout.equals(node.stdout) && r.exitCode === node.exitCode;
  const lines = [];
  if (!same) {
    const a = node.stdout.toString().split("\n");
    const b = r.stdout.toString().split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) lines.push(`line ${i + 1}: node=${JSON.stringify(a[i])} ${backend}=${JSON.stringify(b[i])}`);
    }
  }
  return { verdict: same ? "EXACT" : "DIVERGE", exitCode: r.exitCode, lines, advisories: advis, stdout: r.stdout.toString(), binaryPath: result.binaryPath };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entry = resolve(process.argv[2]);
  const dynamic = process.argv.includes("--dynamic");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const node = await nodeOracle(entry);
  console.log("=== NODE exit=" + node.exitCode);
  process.stdout.write(node.stdout);
  if (node.stderr.length) process.stderr.write("[node stderr] " + node.stderr.toString());
  for (const backend of only ? [only] : ["c", "llvm"]) {
    const r = await oneBackend(entry, backend, node, { dynamic });
    console.log(`=== ${backend.toUpperCase()} ${r.verdict}${r.exitCode !== undefined ? " exit=" + r.exitCode : ""}`);
    for (const d of r.diags ?? []) console.log("  " + d);
    for (const a of r.advisories ?? []) console.log("  [advice] " + a);
    if (r.detail) console.log("  " + r.detail);
    if (r.stdout !== undefined) process.stdout.write(r.stdout);
    for (const l of r.lines ?? []) console.log("  " + l);
  }
}
