/* sweep-keyorder.mjs — run a whole directory of cells on one or both backends
 * against the Node oracle, and print a verdict table.
 *
 * SELF-TEST FIRST, ALWAYS. A sweep that silently measures nothing passes, so
 * three planted cells run before any real one and the sweep ABORTS unless all
 * three land on their planted verdict: one exact, one refused, one that
 * diverges for a reason that has nothing to do with what is being measured.
 *
 * Usage: node sweep-keyorder.mjs <dir> [--only=c|llvm] [--out=file.json]
 *                                [--filter=substr] [--no-selftest-abort]
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { nodeOracle, oneBackend } from "./run-keyorder.mjs";

const SELFTEST_DIR = process.env["KO_SELFTEST"] ?? join(tmpdir(), "scr-ko-selftest");
const PLANTED = { st_exact: "EXACT", st_diverge: "DIVERGE", st_refuse: "REFUSE" };

async function verdictOf(entry, backend) {
  const node = await nodeOracle(entry);
  const r = await oneBackend(entry, backend, node);
  return { ...r, nodeOut: node.stdout.toString() };
}

export async function selfTest(backend) {
  const rows = [];
  for (const [name, want] of Object.entries(PLANTED)) {
    const r = await verdictOf(join(SELFTEST_DIR, name + ".ts"), backend);
    rows.push({ name, want, got: r.verdict, ok: r.verdict === want });
  }
  return rows;
}

const dir = resolve(process.argv[2]);
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const filter = process.argv.find((a) => a.startsWith("--filter="))?.slice(9);
const backends = only ? [only] : ["c", "llvm"];

for (const backend of backends) {
  const st = await selfTest(backend);
  for (const r of st) console.log(`[selftest ${backend}] ${r.name} want=${r.want} got=${r.got} ${r.ok ? "ok" : "*** BROKEN ***"}`);
  if (st.some((r) => !r.ok) && !process.argv.includes("--no-selftest-abort")) {
    console.error(`SELF-TEST FAILED on ${backend}: the sweep cannot see what it claims to measure. Aborting.`);
    process.exit(3);
  }
}

const files = readdirSync(dir).filter((f) => f.endsWith(".ts")).filter((f) => !filter || f.includes(filter)).sort();
const results = [];
for (const backend of backends) {
  const tally = {};
  for (const f of files) {
    const entry = join(dir, f);
    const r = await verdictOf(entry, backend);
    tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
    results.push({
      cell: f.replace(/\.ts$/, ""),
      backend,
      verdict: r.verdict,
      node: r.nodeOut.trim(),
      got: (r.stdout ?? "").trim(),
      codes: r.codes ?? [],
      advisories: (r.advisories ?? []).map((a) => a.split(":")[0]),
      detail: r.detail ?? null,
    });
    process.stdout.write(`\r${backend} ${results.length}/${files.length * backends.length}   `);
  }
  console.log(`\n=== ${backend}: ${JSON.stringify(tally)} over ${files.length} cells`);
}
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
