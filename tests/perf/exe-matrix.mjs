/**
 * exe-matrix.mjs - THROUGHPUT, exe vs Node, per scenario.
 *
 * This is the fourth column the in-process suite does not have. The
 * existing packages/fake-server/bench/native-backend-matrix.cjs compares
 * three CRYPTO BACKENDS under one runtime (Node). This compares two
 * RUNTIMES for one program: the same .bench.ts source run by Node, and the
 * same source compiled to a native .exe by scriptc. Any difference is
 * therefore the compiler's, exactly as drv.mjs makes a behavioural
 * difference the compiler's.
 *
 * The matrix/profile split of the original is preserved: THIS file runs
 * clean, uninstrumented processes and its numbers are the ones to quote.
 * exe-profile.mjs runs instrumented processes whose throughput is
 * attribution-only and NOT comparable with these.
 *
 * What is and is not comparable across the two lanes:
 *   elapsedMs / throughput  comparable, but see CLOCK below
 *   cpuTimeMs               comparable: both lanes read GetProcessTimes
 *   maxRSSkb                comparable: both read PeakWorkingSetSize
 *   retained JS heap        NOT MEASURED. It has no analogue in a C binary
 *                           and comparing it to RSS would be a false number
 *   wallMs (external)       comparable and authoritative: measured here
 *                           with process.hrtime.bigint()
 *
 * CLOCK: the compiled runtime's performance.now() is GetTickCount64
 * (packages/runtime/src/scr_lib.c scr_uptime_now_ms) and ticks at ~15.6 ms
 * on this host; Node's ticks at ~0.0005 ms. Measured, not assumed. Every
 * scenario therefore runs for BENCH_MIN_MS (default 2000) so one tick is
 * under 1% error, and the whole-process wall time is ALSO taken here with
 * the high-resolution clock so no claim rests on the coarse one.
 *
 * Run:
 *   node tests/perf/exe-matrix.mjs --build --runs 5 --json out.json
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { cpus, loadavg, totalmem, freemem, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireToolchain, toolchainLine } from './toolchain.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH_DIR = path.join(HERE, 'bench')
const REPO = path.resolve(HERE, '..', '..')
const CLI = path.join(REPO, 'packages', 'cli', 'dist', 'main.js')

const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  if (i < 0) return d
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? '1' : v
}
const has = (n) => argv.includes('--' + n)

const LANES = flag('lanes', 'node,exe').split(',').map((s) => s.trim())
const RUNS = Number.parseInt(flag('runs', '5'), 10)
const WARMUP = Number.parseInt(flag('warmup', '1'), 10)
// Compiled benches land OUTSIDE the repo by default: a 30 MB .exe in a
// worktree is a dirty tree waiting to happen, and three agents share this
// checkout's parent directory.
const OUTDIR = flag('exe-dir', path.join(tmpdir(), 'scriptc-perf-exe'))
const JSONOUT = flag('json', null)
const MINMS = flag('min-ms', '2000')

const ALL = readdirSync(BENCH_DIR)
  .filter((f) => f.endsWith('.bench.ts'))
  .map((f) => f.replace(/\.bench\.ts$/, ''))
const BENCHES = flag('benches', ALL.join(',')).split(',').map((s) => s.trim()).filter(Boolean)
for (const b of BENCHES) {
  if (!ALL.includes(b)) {
    console.error(`unknown bench '${b}' (have: ${ALL.join(', ')})`)
    process.exit(2)
  }
}

// -- machine-quiet probe ----------------------------------------------
// Two other agents and six Next.js dev servers share this box. A timing
// number taken while they are busy is not a number, so the state is
// RECORDED next to the results instead of being assumed away.
function machineState(label) {
  const ps = spawnSync(
    'powershell',
    ['-NoProfile', '-Command',
      '$c=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; ' +
      '$n=(Get-Process | Measure-Object).Count; ' +
      '$node=(Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count; ' +
      '$zig=(Get-Process zig -ErrorAction SilentlyContinue | Measure-Object).Count; ' +
      'Write-Output "$c|$n|$node|$zig"'],
    { encoding: 'utf8' }
  )
  const raw = (ps.stdout || '').trim()
  const [cpu, procs, nodeProcs, zigProcs] = raw.split('|')
  return {
    label,
    at: new Date().toISOString(),
    cpuLoadPercent: Number(cpu),
    processCount: Number(procs),
    nodeProcesses: Number(nodeProcs),
    zigProcesses: Number(zigProcs),
    freeMemMiB: Math.round(freemem() / 1048576),
    totalMemMiB: Math.round(totalmem() / 1048576),
    logicalCpus: cpus().length,
    loadavg: loadavg()
  }
}

// -- build -------------------------------------------------------------
function exePath(bench) {
  return path.join(OUTDIR, bench + '.exe')
}

function build(bench, extraArgs = []) {
  mkdirSync(OUTDIR, { recursive: true })
  const out = exePath(bench)
  try { rmSync(out, { force: true }) } catch { /* nothing to remove */ }
  const t = process.hrtime.bigint()
  const res = spawnSync(
    process.execPath,
    [CLI, 'build', bench + '.bench.ts', '--backend', 'c', ...extraArgs, '-o', out],
    { cwd: BENCH_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  )
  const ms = Number(process.hrtime.bigint() - t) / 1e6
  if (res.status !== 0) {
    process.stderr.write(res.stdout ?? '')
    process.stderr.write(res.stderr ?? '')
    throw new Error(`build failed for ${bench} (exit ${res.status})`)
  }
  // A build that failed is not a build that was fast, and a stale exe from
  // a previous session is the one artefact that reads as a spectacular win.
  // The target was removed above, so its EXISTENCE now is the proof this
  // build produced it. Deliberately NOT an mtime test: this lane USES the
  // build cache, and the cache restores a linked binary with its original
  // mtime, so a cache hit would read as stale.
  if (!existsSync(out)) throw new Error(`build for ${bench} reported success but wrote no ${out}`)
  const st = statSync(out)
  if (st.size === 0) throw new Error(`build for ${bench} wrote a ZERO-BYTE ${out}`)
  return { out, buildMs: ms, bytes: st.size }
}

// -- run one process, parse the SCBENCH protocol -----------------------
function runOnce(bench, lane, env) {
  const spec = lane === 'exe'
    ? { file: exePath(bench), args: [] }
    : { file: process.execPath, args: ['--experimental-strip-types', path.join(BENCH_DIR, bench + '.bench.ts')] }
  if (lane === 'exe' && !existsSync(spec.file)) {
    throw new Error(`missing ${spec.file} - run with --build`)
  }

  const t0 = process.hrtime.bigint()
  const res = spawnSync(spec.file, spec.args, {
    cwd: BENCH_DIR,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env, BENCH_LANE: lane, BENCH_MIN_MS: MINMS }
  })
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6

  if (res.status !== 0) {
    process.stderr.write(res.stdout ?? '')
    process.stderr.write(res.stderr ?? '')
    throw new Error(`${lane}/${bench} exited ${res.status}`)
  }
  const scenarios = []
  let end = null
  let checksum = null
  for (const line of (res.stdout ?? '').split('\n')) {
    const s = line.trim()
    if (s.startsWith('SCBENCH {')) scenarios.push(JSON.parse(s.slice('SCBENCH '.length)))
    else if (s.startsWith('SCBENCH-END ')) end = JSON.parse(s.slice('SCBENCH-END '.length))
    else if (s.startsWith('SCBENCH-CHECKSUM ')) checksum = s.slice('SCBENCH-CHECKSUM '.length)
  }
  if (scenarios.length === 0 && bench !== 'startup') {
    throw new Error(`${lane}/${bench} produced no SCBENCH lines`)
  }
  return { wallMs, scenarios, end, checksum }
}

// -- stats -------------------------------------------------------------
function median(v) {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function stats(v) {
  if (!v || v.length === 0) return null
  const med = median(v)
  const min = Math.min(...v)
  const max = Math.max(...v)
  return { median: med, min, max, n: v.length, spreadPct: med > 0 ? ((max - min) / med) * 100 : 0 }
}

const METRICS = ['throughputOpsPerSec', 'elapsedMs', 'cpuTimeMs', 'cpuPercent', 'maxRSSkb', 'opsCount']

async function main() {
  const started = Date.now()
  // Which compiler built the exe lane is part of every number below; see
  // toolchain.mjs for why it is recorded rather than assumed.
  const tc = requireToolchain()
  const before = machineState('before')
  console.log('cross-runtime bench matrix - exe vs Node, per scenario')
  console.log(`benches: ${BENCHES.join(', ')}   lanes: ${LANES.join(', ')}`)
  console.log(`${WARMUP} warmup + ${RUNS} measured runs per (bench, lane); BENCH_MIN_MS=${MINMS}`)
  console.log(toolchainLine(tc))
  console.log(`machine before: cpu ${before.cpuLoadPercent}%  procs ${before.processCount}  node ${before.nodeProcesses}  zig ${before.zigProcesses}  free ${before.freeMemMiB} MiB`)
  console.log('')

  const builds = {}
  if (has('build') && LANES.includes('exe')) {
    for (const b of BENCHES) {
      process.stdout.write(`  building ${b} ... `)
      const r = build(b)
      builds[b] = r.buildMs
      console.log(`${(r.buildMs / 1000).toFixed(1)}s -> ${r.out}`)
    }
    console.log('')
  }

  const result = {
    schema: 'scriptc-perf-matrix/1',
    startedAt: new Date().toISOString(),
    toolchain: tc,
    machine: { before },
    config: { benches: BENCHES, lanes: LANES, runs: RUNS, warmup: WARMUP, minMs: MINMS },
    builds,
    data: {}
  }

  for (const bench of BENCHES) {
    result.data[bench] = {}
    for (const lane of LANES) {
      console.log(`### ${bench} / ${lane}`)
      for (let w = 0; w < WARMUP; w++) {
        process.stdout.write(`  warmup ${w + 1}/${WARMUP} ... `)
        const r = runOnce(bench, lane, {})
        console.log(`${(r.wallMs / 1000).toFixed(1)}s (discarded)`)
      }
      const perScenario = {}
      const wall = []
      const endMaxRss = []
      const checksums = new Set()
      for (let i = 0; i < RUNS; i++) {
        process.stdout.write(`  run ${i + 1}/${RUNS} ... `)
        const r = runOnce(bench, lane, {})
        wall.push(r.wallMs)
        if (r.end) endMaxRss.push(r.end.maxRSSkb)
        if (r.checksum) checksums.add(r.checksum)
        for (const s of r.scenarios) {
          const rec = (perScenario[s.name] ??= { opsLabel: s.opsLabel, suspectFolded: false, values: {} })
          if (s.suspectFolded) rec.suspectFolded = true
          for (const m of METRICS) (rec.values[m] ??= []).push(s[m])
        }
        console.log(
          `${(r.wallMs / 1000).toFixed(2)}s   ` +
          r.scenarios.map((s) => `${s.name}=${Math.round(s.throughputOpsPerSec)}${s.suspectFolded ? '!' : ''}`).join('  ')
        )
      }
      const laneRec = {
        wallMs: stats(wall),
        processMaxRSSkb: stats(endMaxRss),
        checksums: [...checksums],
        scenarios: {}
      }
      for (const [name, rec] of Object.entries(perScenario)) {
        laneRec.scenarios[name] = { opsLabel: rec.opsLabel, suspectFolded: rec.suspectFolded }
        for (const m of METRICS) laneRec.scenarios[name][m] = stats(rec.values[m])
      }
      result.data[bench][lane] = laneRec
      console.log('')
    }
  }

  result.machine.after = machineState('after')
  result.totalWallSec = (Date.now() - started) / 1000

  // -- report ----------------------------------------------------------
  const bar = '='.repeat(100)
  const col = (v, w = 15) => String(v).padStart(w)
  for (const bench of BENCHES) {
    console.log(bar)
    console.log(`${bench}  -  MEDIAN throughput (ops/s), spread = (max-min)/median over ${RUNS} runs`)
    console.log('-'.repeat(100))
    console.log('scenario'.padEnd(18) + LANES.map((l) => col(l)).join('') + col('spread%') + col('exe/node') + '  note')
    const names = new Set()
    for (const l of LANES) for (const n of Object.keys(result.data[bench][l]?.scenarios ?? {})) names.add(n)
    for (const n of names) {
      const row = [n.padEnd(18)]
      let spreadMax = 0
      let folded = false
      for (const l of LANES) {
        const s = result.data[bench][l]?.scenarios[n]
        row.push(col(s ? Math.round(s.throughputOpsPerSec.median).toLocaleString('en-US') : '-'))
        if (s) {
          spreadMax = Math.max(spreadMax, s.throughputOpsPerSec.spreadPct)
          folded = folded || s.suspectFolded
        }
      }
      row.push(col(spreadMax.toFixed(1)))
      const e = result.data[bench].exe?.scenarios[n]?.throughputOpsPerSec.median
      const nd = result.data[bench].node?.scenarios[n]?.throughputOpsPerSec.median
      row.push(col(e && nd ? (e / nd).toFixed(2) + 'x' : '-'))
      row.push('  ' + (folded ? 'SUSPECT: loop folded, NOT a throughput number' : ''))
      console.log(row.join(''))
    }
    console.log('-'.repeat(100))
    console.log('whole process'.padEnd(18) +
      LANES.map((l) => col((result.data[bench][l]?.wallMs.median ?? 0).toFixed(0) + 'ms')).join('') +
      col(Math.max(...LANES.map((l) => result.data[bench][l]?.wallMs.spreadPct ?? 0)).toFixed(1)))
    console.log('peak RSS'.padEnd(18) +
      LANES.map((l) => col(((result.data[bench][l]?.processMaxRSSkb?.median ?? 0) / 1024).toFixed(1) + ' MiB')).join(''))
  }
  console.log(bar)
  console.log(`machine before: cpu ${before.cpuLoadPercent}%  node ${before.nodeProcesses}  zig ${before.zigProcesses}  free ${before.freeMemMiB} MiB`)
  console.log(`machine after : cpu ${result.machine.after.cpuLoadPercent}%  node ${result.machine.after.nodeProcesses}  zig ${result.machine.after.zigProcesses}  free ${result.machine.after.freeMemMiB} MiB`)
  console.log(`total wall: ${(result.totalWallSec / 60).toFixed(1)} min`)
  console.log('peak RSS is PeakWorkingSetSize on both lanes. Retained JS heap is not measured and not compared.')

  if (JSONOUT) {
    writeFileSync(JSONOUT, JSON.stringify(result, null, 2))
    console.log(`wrote ${JSONOUT}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
