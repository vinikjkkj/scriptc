// Shared bench infrastructure for the CROSS-RUNTIME bench suite.
//
// This file is the seam. It is written in the subset scriptc compiles, so
// the SAME source runs two ways:
//
//   node --experimental-strip-types x.bench.ts     (the Node lane)
//   scriptc build x.bench.ts -o x.exe && ./x.exe   (the compiled lane)
//
// Any difference between the two lanes is therefore the compiler's, exactly
// as srvpq.mjs/drv.mjs make behavioural differences the compiler's.
//
// It deliberately mirrors packages/fake-server/bench/_common.ts's
// ScenarioResult field names so results are diffable against the existing
// in-process suite. Two fields are NOT carried, and the reason matters:
//
//   heapDeltaBytes  - process.memoryUsage() has NO lowering row
//                     (packages/compiler/src/ir/nodes.ts:8905). There is no
//                     retained-JS-heap analogue in a C binary and inventing
//                     one would be a false number.
//   rssBeforeBytes  - same reason.
//
// What IS carried across runtimes is peak RSS, because both lanes read the
// SAME Windows counter: scr_lib.c's scr_process_rusage case 2 goes to
// PeakWorkingSetSize via K32GetProcessMemoryInfo, and libuv's uv_getrusage
// does the same for Node. maxRSSkb is the one honest memory number here.
//
// CLOCK WARNING, measured on this host 2026-08-18 and not assumed:
//   performance.now() tick   Node 0.00048 ms   compiled exe 15.65 ms
// The compiled runtime's clock is GetTickCount64 (scr_lib.c
// scr_uptime_now_ms), so it cannot resolve anything below ~16 ms. Every
// scenario here therefore targets BENCH_MIN_MS of wall time (default 2000),
// at which a one-tick error is under 1%. The driver additionally times the
// whole process externally with Node's high-resolution clock, so no claim
// rests on the coarse clock alone.

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const n = Number(raw)
  if (!(n > 0)) return fallback
  return n
}

export function envStr(name: string, fallback: string): string {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  return raw
}

// ── the machine-readable protocol ────────────────────────────────────
// One line per scenario, prefixed so it survives interleaved stdout:
//   SCBENCH {"name":"...","opsCount":N,...}
// and one trailer:
//   SCBENCH-END {"lane":"...","maxRSSkb":N,...}
// Fields are emitted in a FIXED order by hand rather than via
// JSON.stringify, so the two lanes cannot diverge on key order or on
// number formatting inside an object.

// Exported because the bench files emit their own control lines, and a
// Windows path in one of them is a backslash storm: an unescaped
// G:\x\y.db is not JSON, and the driver's parse throws on a line
// that is otherwise a perfectly good measurement.
export function jstr(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (c === '"') out += '\\"'
    else if (c === "\\") out += "\\\\"
    else out += c
  }
  return '"' + out + '"'
}

export function benchLane(): string {
  return envStr("BENCH_LANE", "unknown")
}

let scenarioCount = 0

export function runScenario(
  name: string,
  opsLabel: string,
  opsPerBatch: number,
  batch: () => void,
  foldCeiling: number = 0
): void {
  // BENCH_ONLY=<name> runs exactly one scenario. Attribution needs it:
  // a per-function CPU profile of a seven-scenario process attributes
  // the WHOLE process, and the question is usually about one axis. The
  // skipped scenarios emit nothing, so a filtered run is visibly a
  // filtered run rather than a run with missing rows.
  const only = envStr("BENCH_ONLY", "")
  if (only !== "" && only !== name) return
  const minMs = envInt("BENCH_MIN_MS", 2000)
  const maxBatches = envInt("BENCH_MAX_BATCHES", 1000000000)

  // Warm the code path once outside the measurement, mirroring the
  // matrix driver's discarded warmup but at batch granularity.
  batch()

  const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  let batches = 0
  let elapsed = 0
  while (elapsed < minMs && batches < maxBatches) {
    batch()
    batches++
    elapsed = performance.now() - t0
  }
  const cpu1 = process.cpuUsage(cpu0)
  const ru = process.resourceUsage()

  const ops = opsPerBatch * batches
  const cpuTimeMs = (cpu1.user + cpu1.system) / 1000
  const throughput = elapsed > 0 ? (ops / elapsed) * 1000 : 0
  const avgMsPerOp = ops > 0 ? elapsed / ops : 0
  const cpuPercent = elapsed > 0 ? (cpuTimeMs / elapsed) * 100 : 0

  // Self-test: a scenario that reports more ops/s than any real work can
  // do at this clock was FOLDED AWAY by the optimiser (LLVM closes the
  // form of an accumulator loop; V8 deletes a loop whose result is
  // unobservable). Publishing such a number as throughput is the exact
  // false-green this harness exists to avoid, so it is labelled in the
  // record rather than silently emitted.
  const suspect = foldCeiling > 0 && throughput > foldCeiling

  scenarioCount++
  console.log(
    "SCBENCH {" +
      '"name":' + jstr(name) +
      ',"opsLabel":' + jstr(opsLabel) +
      ',"batches":' + batches +
      ',"opsCount":' + ops +
      ',"elapsedMs":' + elapsed +
      ',"throughputOpsPerSec":' + throughput +
      ',"avgMsPerOp":' + avgMsPerOp +
      ',"cpuTimeMs":' + cpuTimeMs +
      ',"cpuPercent":' + cpuPercent +
      ',"maxRSSkb":' + ru.maxRSS +
      ',"suspectFolded":' + (suspect ? "true" : "false") +
      "}"
  )
}

export function benchEnd(): void {
  const ru = process.resourceUsage()
  const cpu = process.cpuUsage()
  console.log(
    "SCBENCH-END {" +
      '"lane":' + jstr(benchLane()) +
      ',"scenarios":' + scenarioCount +
      ',"maxRSSkb":' + ru.maxRSS +
      ',"cpuUserUs":' + cpu.user +
      ',"cpuSystemUs":' + cpu.system +
      ',"uptimeSec":' + process.uptime() +
      "}"
  )
}
