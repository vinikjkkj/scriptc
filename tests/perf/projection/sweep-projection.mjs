/* sweep-projection.mjs — compile+run a DIRECTORY of entries on one backend
 * and diff each against Node. Prints one row per program and a tally.
 * Usage: node sweep-projection.mjs <dir> [--backend=c] [--tag=name]
 *
 * SELF-TEST: --selftest plants three programs (one exact, one diverging,
 * one refusing) and asserts the sweep reports one of each. A sweep that
 * silently measures nothing PASSES, so the sweep refuses to run without
 * having proved it can report all three verdicts. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

/* The repo this script lives in, not the worktree it was written in. */
const repoRoot = process.env["PJ_REPO"] ?? resolve(fileURLToPath(import.meta.url), "../../../..");
const PJ_TMP = process.env["PJ_TMP"] ?? join(tmpdir(), "scr-pj");
const { compile } = await import(pathToFileURL(join(repoRoot, "packages/compiler/dist/index.js")).href);
const execFileAsync = promisify(execFile);

async function runBinary(cmd, args) {
  const p = execFileAsync(cmd, args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  p.child.stdin?.end();
  try { const { stdout, stderr } = await p; return { stdout, stderr, exitCode: 0 }; }
  catch (e) {
    if (typeof e.code !== "number") return { stdout: e.stdout ?? Buffer.alloc(0), stderr: Buffer.from(String(e.message)), exitCode: -1 };
    return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code };
  }
}

const nodeShims = [
  "--import", pathToFileURL(join(repoRoot, "tests/harness/comptime-shim.mjs")).href,
  "--import", pathToFileURL(join(repoRoot, "tests/harness/island-shim.mjs")).href,
];

/** One program: NODE, EXACT, DIVERGE, REFUSE, THREW. */
async function verdict(entry, backend, cacheRoot) {
  const src = readFileSync(entry, "utf8");
  const tt = /\benum\s+[A-Za-z_$]/.test(src) || /^\/\/ @transform-types/m.test(src);
  const args = [...(tt ? ["--experimental-transform-types", "--disable-warning=ExperimentalWarning"] : []), ...nodeShims, entry];
  const node = await runBinary(process.execPath, args);
  const key = createHash("sha256").update(entry).update(src).update(backend).digest("hex").slice(0, 16);
  const outDir = join(cacheRoot, key);
  mkdirSync(outDir, { recursive: true });
  let res;
  try { res = await compile(entry, { outPath: join(outDir, "program.exe"), outDir, backend }); }
  catch (e) { return { v: "THREW", note: String(e && e.message).split("\n")[0] }; }
  if (!res.ok) return { v: "REFUSE", note: res.diagnostics.map((d) => d.code).join("+"), diag: res.diagnostics };
  const r = await runBinary(res.binaryPath, []);
  if (r.stdout.equals(node.stdout) && r.exitCode === node.exitCode) return { v: "EXACT" };
  return {
    v: "DIVERGE",
    node: node.stdout.toString().trimEnd(), got: r.stdout.toString().trimEnd(),
    nodeExit: node.exitCode, gotExit: r.exitCode,
    err: r.stderr.toString().trimEnd().split("\n")[0] ?? "",
  };
}

async function sweep(dir, backend, cacheRoot) {
  const files = globSync(join(dir, "*.ts")).sort();
  const rows = [];
  for (const f of files) rows.push({ name: basename(f, ".ts"), ...(await verdict(f, backend, cacheRoot)) });
  return rows;
}

async function selftest() {
  const d = join(PJ_TMP, "selftest-projection");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "a-exact.ts"), Buffer.from('console.log("ok");\n', "utf8"));
  // A KNOWN divergence, independent of anything this branch touches: the
  // widened-record key listing itself would be circular, so use a planted
  // program whose two sides differ by construction is impossible (Node IS
  // the oracle). Instead plant a program that DIVERGES because it prints
  // a value only Node can produce: an explicit `undefined` field, whose
  // presence is a DOCUMENTED divergence (tests/corpus/3713).
  writeFileSync(join(d, "b-diverge.ts"), Buffer.from(
    'interface M { a?: number }\nconst m: M = { a: undefined };\nconsole.log(Object.keys(m).join(","));\n', "utf8"));
  writeFileSync(join(d, "c-refuse.ts"), Buffer.from(
    'function f(o: unknown): string { return JSON.stringify({ ...(o as object) }); }\nconsole.log(f({}));\n', "utf8"));
  const rows = await sweep(d, "c", join(PJ_TMP, "cache-selftest"));
  const got = Object.fromEntries(rows.map((r) => [r.name, r.v]));
  console.log("SELFTEST " + JSON.stringify(got));
  const ok = got["a-exact"] === "EXACT" && got["b-diverge"] === "DIVERGE" && got["c-refuse"] === "REFUSE";
  console.log(ok ? "SELFTEST PASS — the sweep can report all three verdicts" : "SELFTEST FAIL");
  if (!ok) process.exitCode = 1;
  return ok;
}

const dir = process.argv[2];
const backend = process.argv.find((a) => a.startsWith("--backend="))?.slice(10) ?? "c";
if (process.argv.includes("--selftest") || !dir) { await selftest(); }
else {
  if (!(await selftest())) { console.log("refusing to sweep: the instrument failed its self-test"); process.exit(1); }
  const rows = await sweep(resolve(dir), backend, join(PJ_TMP, "cache-sweep-" + backend));
  const tally = {};
  for (const r of rows) tally[r.v] = (tally[r.v] ?? 0) + 1;
  for (const r of rows) {
    if (r.v === "EXACT") { console.log(`EXACT    ${r.name}`); continue; }
    if (r.v === "REFUSE") { console.log(`REFUSE   ${r.name}  ${r.note}`); continue; }
    if (r.v === "THREW") { console.log(`THREW    ${r.name}  ${r.note}`); continue; }
    console.log(`DIVERGE  ${r.name}  node=${JSON.stringify(r.node)}(${r.nodeExit}) got=${JSON.stringify(r.got)}(${r.gotExit})${r.err ? " err=" + JSON.stringify(r.err) : ""}`);
  }
  console.log(`\nTALLY backend=${backend} n=${rows.length} ` + JSON.stringify(tally));
}
