// patch-drv.mjs — turn the fake-server driver into a MEASURING driver.
//
//   node patch-drv.mjs <drv.mjs> <out.mjs>
//
// The driver in G:\zapo-work spawns the client itself and reads its stdout, so
// the client cannot be wrapped from the shell without losing the QR handshake.
// This makes four surgical edits, each of which FAILS LOUDLY if its anchor has
// moved, rather than silently producing a driver that measures nothing:
//
//   1. the client is launched through runner.exe (DV_RUNNER + DV_METRICS), so
//      the compiled lane and the Node lane are measured by the same kernel
//      counter, from outside the process, by the same code.
//   2. DV_NODE picks WHICH node runs the Node lane.  `node` on PATH is
//      v22.18.0 and the oracle is v25.9.0; they are not interchangeable and
//      every row has to name which one it is.
//   3. the summary gains MEM lines, so a run's memory number lives in the same
//      log as its stanza count and its exit code.
//   4. readFileSync is imported, because 3 needs it.
//
// An unpatched driver is not a fallback: with no DV_RUNNER the launch is
// unchanged and NO metrics file is written at all, which the runner script
// reports as "DID NOT HAPPEN" rather than as a zero.

import { readFileSync, writeFileSync } from "node:fs";

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error("usage: node patch-drv.mjs <drv.mjs> <out.mjs>"); process.exit(2); }

let s = readFileSync(src, "utf8");
const before = s;

function edit(name, anchor, replacement) {
  if (!s.includes(anchor)) { console.error(`patch-drv: anchor MISSING for ${name}: ${anchor}`); process.exit(1); }
  s = s.replace(anchor, replacement);
  console.log(`  ok  ${name}`);
}

edit("1. route the client through runner.exe",
  "const client = spawn(spec.file, spec.args, {",
  [
    "const RUNNER = process.env.DV_RUNNER ?? null;",
    "const METRICS = process.env.DV_METRICS ?? null;",
    "const launch = RUNNER && METRICS",
    "  ? { file: RUNNER, args: [METRICS, spec.file, ...spec.args] }",
    "  : spec;",
    "if (RUNNER) out(\"D>\", `runner=${RUNNER} metrics=${METRICS}`);",
    "const client = spawn(launch.file, launch.args, {",
  ].join("\n"));

edit("2. DV_NODE picks the Node lane's node",
  '{ file: process.execPath, args: ["--experimental-strip-types", flag("entry", "dvmax.ts")] }',
  '{ file: process.env.DV_NODE ?? process.execPath, args: ["--experimental-strip-types", flag("entry", "dvmax.ts")] }');

edit("3. MEM lines in the summary",
  'out("D>", `log at ${LOG}`);',
  [
    "try {",
    "  if (METRICS) {",
    '    const m = JSON.parse(readFileSync(METRICS, "utf8"));',
    '    out("MEM", `peakWorkingSetBytes=${m.peakWorkingSetBytes}`);',
    '    out("MEM", `peakPagefileBytes=${m.peakPagefileBytes}`);',
    '    out("MEM", `cpuTotalMs=${m.cpuTotalMs} cpuUserMs=${m.cpuUserMs} cpuKernelMs=${m.cpuKernelMs}`);',
    '    out("MEM", `clientWallMs=${m.wallMs} clientExit=${m.exit} memOk=${m.memOk} pageFaults=${m.pageFaults}`);',
    "  }",
    "} catch (e) { out(\"D!\", `metrics: ${e?.message ?? e}`); }",
    'out("D>", `log at ${LOG}`);',
  ].join("\n"));

edit("4. import readFileSync",
  'import { createWriteStream, writeFileSync } from "node:fs";',
  'import { createWriteStream, writeFileSync, readFileSync } from "node:fs";');

if (s === before) { console.error("patch-drv: nothing changed"); process.exit(1); }
writeFileSync(dst, s);
console.log(`wrote ${dst} (${s.length} bytes, was ${before.length})`);
