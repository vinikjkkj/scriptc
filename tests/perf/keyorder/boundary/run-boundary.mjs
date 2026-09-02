/* Differential runner for the key-order boundary probes.
 *
 * For each probe: run the ORACLE (node v25.9.0 via the repo's tsx) and then
 * scriptc on BOTH backends, byte-exact on stdout. Verdicts are
 * MATCH / WRONG / TRAP (non-zero exit or refusal) / DID-NOT-RUN.
 *
 * The harness's own liveness is proved by p17: its oracle line
 * "sentinel=ORDER-HARNESS-ALIVE" is compared like every other byte, and a
 * deliberately corrupted expectation (--selftest) must turn it WRONG.
 *
 *   node tests/perf/keyorder/boundary/run-boundary.mjs
 *   node tests/perf/keyorder/boundary/run-boundary.mjs <dir> p17 --selftest
 *
 * Requires a BUILT tree (packages/cli/dist) and node v25.9.0 first on PATH:
 * the oracle is spawned as process.execPath, so a v22 shell silently
 * compares against the wrong runtime.
 *
 * RECORDED, llvm and c identical on both lines:
 *   main b5df95f1     {"TRAP":10,"WRONG":5,"MATCH":5}
 *   block/keyorder    {"TRAP":13,"WRONG":2,"MATCH":5}
 * At base the five WRONG were p02/p16 (one dyn cast seen through Object.keys
 * and through JSON.stringify/for-in, SC6002-advised) and p06/p19/p20, which
 * carried no diagnostic at all. p06/p19/p20 are now refusals; p02/p16 still
 * answer the shape's order and still only advise, which is the defect a
 * per-instance key order has to close. */
import { execFileSync } from "node:child_process";
import { readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? join(import.meta.dirname, "p");
const only = process.argv[3];
const selftest = process.argv.includes("--selftest");
const WT = join(import.meta.dirname, "../../../..");
const CLI = join(WT, "packages/cli/dist/main.js");
const TSX = join(WT, "node_modules/tsx/dist/cli.mjs");
const OUT = join(process.env["TMPDIR"] ?? process.env["TMP"] ?? ".", "keyorder-boundary");
mkdirSync(OUT, { recursive: true });

const run = (cmd, args, opts = {}) => {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000,
      ...opts,
    });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) };
  }
};

const files = readdirSync(dir)
  .filter((f) => /\.(ts|js|cjs|mjs)$/.test(f))
  .filter((f) => !only || f.includes(only))
  .sort();

const rows = [];
for (const f of files) {
  const src = join(dir, f);
  const oracle = run(process.execPath, [TSX, src]);
  let want = oracle.ok ? oracle.stdout : null;
  if (selftest && f.startsWith("p17")) want = (want ?? "") + "HARNESS-SELFTEST-POISON\n";
  const row = { file: f, oracle: oracle.ok ? "ok" : "TRAP", want };
  for (const backend of ["llvm", "c"]) {
    if (want === null) {
      row[backend] = "DID-NOT-RUN";
      continue;
    }
    const exe = join(OUT, `${f.replace(/\W/g, "_")}-${backend}.exe`);
    const built = run(process.execPath, [CLI, "build", src, "--backend", backend, "-o", exe]);
    if (!built.ok) {
      row[backend] = "TRAP";
      row[backend + "_why"] = (built.stderr || built.stdout).split("\n").filter((l) => l.trim()).slice(-9).join(" | ");
      continue;
    }
    const ran = run(exe, []);
    if (!ran.ok) {
      row[backend] = "TRAP";
      row[backend + "_why"] = (ran.stderr || "").split("\n").filter((l) => l.trim()).slice(-2).join(" | ");
      continue;
    }
    row[backend] = ran.stdout === want ? "MATCH" : "WRONG";
    if (ran.stdout !== want) row[backend + "_got"] = ran.stdout.trim().replace(/\n/g, " ⏎ ");
    row[backend + "_adv"] = /SC6002/.test(built.stdout + built.stderr) ? "SC6002" : "";
  }
  rows.push(row);
  const w = (want ?? "").trim().replace(/\n/g, " ⏎ ");
  console.log(
    `${f.padEnd(34)} llvm=${String(row.llvm).padEnd(11)} c=${String(row.c).padEnd(11)} adv=${(row.llvm_adv || row.c_adv || "-").padEnd(6)} node[${w}]`,
  );
  if (row.llvm_got) console.log(`    llvm got: ${row.llvm_got}`);
  if (row.c_got && row.c_got !== row.llvm_got) console.log(`    c    got: ${row.c_got}`);
  if (row.llvm_why) console.log(`    llvm why: ${row.llvm_why}`);
  if (row.c_why && row.c_why !== row.llvm_why) console.log(`    c    why: ${row.c_why}`);
}

const tally = (b) => {
  const t = {};
  for (const r of rows) t[r[b]] = (t[r[b]] ?? 0) + 1;
  return JSON.stringify(t);
};
console.log(`\nllvm ${tally("llvm")}`);
console.log(`c    ${tally("c")}`);
