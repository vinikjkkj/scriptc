/**
 * ab-strpool.mjs - A/B (and A/A) driver for TWO COMPILED BINARIES of the
 * same bench source, differing only in the -D flags handed to the C
 * compiler.
 *
 * exe-matrix.mjs compares two RUNTIMES (Node vs exe) for one program. This
 * compares two BUILDS of the exe lane, which is what an optimisation of the
 * C runtime needs and what the A/A control needs. Nothing is ever subtracted
 * across branches: both arms are built and run in this process, on this
 * tree, in the same session, ALTERNATING so a drift in machine load lands on
 * both arms equally.
 *
 * Self-test rule: run it with the SAME flags on both arms first (or with one
 * INERT -D). If it cannot report "identical" when nothing differs, its
 * "identical" means nothing when something does. An inert -D that changes no
 * code produces BYTE-IDENTICAL binaries, and the driver says so - which
 * makes the A/A a measurement of pure run-to-run noise with the compiler
 * removed from the question entirely.
 *
 *   node tests/perf/ab-strpool.mjs --runs 9 --a "" --b "-DSCR_AA_INERT=1"
 *   node tests/perf/ab-strpool.mjs --runs 9 --a "" --b "-DSCR_POOL_DEPTH=1024"
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { cpus, totalmem, freemem } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH_DIR = path.join(HERE, 'bench')
const REPO = path.resolve(HERE, '..', '..')
const CLI = path.join(REPO, 'packages', 'cli', 'dist', 'main.js')

const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  if (i < 0) return d
  const v = argv[i + 1]
  return v === undefined ? d : v
}
const BENCH = flag('bench', 'messaging')
const RUNS = Number.parseInt(flag('runs', '9'), 10)
const MINMS = flag('min-ms', '2000')
const ONLY = flag('only', '')
const BATCHES = flag('batches', '')
const OUTDIR = flag('exe-dir', 'G:/zapo-work/caches/strpool/ab')
const A_CFLAGS = flag('a', '')
const B_CFLAGS = flag('b', '')
const A_LABEL = flag('label-a', A_CFLAGS || 'base')
const B_LABEL = flag('label-b', B_CFLAGS || 'base')
const JSONOUT = flag('json', null)
const NOBUILD = argv.includes('--no-build')

function machineState(label) {
  const ps = spawnSync('powershell', ['-NoProfile', '-Command',
    '$c=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; ' +
    '$n=(Get-Process | Measure-Object).Count; ' +
    '$node=(Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count; ' +
    '$zig=(Get-Process zig -ErrorAction SilentlyContinue | Measure-Object).Count; ' +
    '$cl=(Get-Process clang* -ErrorAction SilentlyContinue | Measure-Object).Count; ' +
    'Write-Output "$c|$n|$node|$zig|$cl"'], { encoding: 'utf8' })
  const parts = (ps.stdout || '').trim().split('|')
  return {
    label, at: new Date().toISOString(),
    cpuLoadPercent: Number(parts[0]), processCount: Number(parts[1]),
    nodeProcesses: Number(parts[2]), zigProcesses: Number(parts[3]), clangProcesses: Number(parts[4]),
    freeMemMiB: Math.round(freemem() / 1048576), totalMemMiB: Math.round(totalmem() / 1048576),
    logicalCpus: cpus().length
  }
}

function build(tag, cflags) {
  mkdirSync(OUTDIR, { recursive: true })
  const out = path.join(OUTDIR, BENCH + '-' + tag + '.exe')
  if (NOBUILD && existsSync(out)) return out
  const env = { ...process.env, SCRIPTC_NO_CACHE: '1' }
  if (cflags) env.SCRIPTC_PROF_CFLAGS = cflags
  else delete env.SCRIPTC_PROF_CFLAGS
  const t = process.hrtime.bigint()
  const res = spawnSync(process.execPath, [CLI, 'build', BENCH + '.bench.ts', '--backend', 'c', '-o', out],
    { cwd: BENCH_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env })
  if (res.status !== 0) {
    process.stderr.write((res.stdout ?? '').slice(-4000))
    process.stderr.write((res.stderr ?? '').slice(-4000))
    throw new Error('build failed for ' + tag)
  }
  console.log('  built ' + tag + ' in ' + (Number(process.hrtime.bigint() - t) / 1e9).toFixed(1) + 's -> ' + out)
  return out
}

function runOnce(exe) {
  const t0 = process.hrtime.bigint()
  const env = { ...process.env, BENCH_LANE: 'exe', BENCH_MIN_MS: MINMS }
  if (ONLY) env.BENCH_ONLY = ONLY
  if (BATCHES) env.BENCH_MAX_BATCHES = BATCHES
  const res = spawnSync(exe, [], { cwd: BENCH_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env })
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6
  if (res.status !== 0) {
    process.stderr.write((res.stdout ?? '').slice(0, 4000))
    process.stderr.write((res.stderr ?? '').slice(0, 4000))
    throw new Error(exe + ' exited ' + res.status)
  }
  const scenarios = []
  let end = null
  for (const line of (res.stdout ?? '').split('\n')) {
    const s = line.trim()
    if (s.startsWith('SCBENCH {')) scenarios.push(JSON.parse(s.slice(8)))
    else if (s.startsWith('SCBENCH-END ')) end = JSON.parse(s.slice(12))
  }
  if (scenarios.length === 0) throw new Error('no SCBENCH lines from ' + exe)
  return { wallMs, scenarios, end }
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const spread = (v) => {
  const m = median(v)
  return m > 0 ? ((Math.max(...v) - Math.min(...v)) / m) * 100 : 0
}
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16)

function main() {
  const before = machineState('before')
  console.log('A/B compiled-binary comparison - bench=' + BENCH + ' runs=' + RUNS + ' BENCH_MIN_MS=' + MINMS)
  console.log('  A = ' + A_LABEL + '   [' + (A_CFLAGS || '(no extra cflags)') + ']')
  console.log('  B = ' + B_LABEL + '   [' + (B_CFLAGS || '(no extra cflags)') + ']')
  console.log('machine before: cpu ' + before.cpuLoadPercent + '%  procs ' + before.processCount +
    '  node ' + before.nodeProcesses + '  zig ' + before.zigProcesses + '  clang ' + before.clangProcesses +
    '  free ' + before.freeMemMiB + ' MiB')
  if (before.cpuLoadPercent > 25) {
    console.log('  ** WARNING: machine is NOT quiet (cpu ' + before.cpuLoadPercent + '%). Numbers below are suspect. **')
  }
  console.log('')

  const exeA = build('a', A_CFLAGS)
  const exeB = build('b', B_CFLAGS)
  const szA = statSync(exeA).size
  const szB = statSync(exeB).size
  const hA = sha(exeA)
  const hB = sha(exeB)
  console.log('  A .exe ' + szA + ' bytes  sha ' + hA)
  console.log('  B .exe ' + szB + ' bytes  sha ' + hB + (hA === hB ? '   << BYTE-IDENTICAL BINARIES (a perfect A/A)' : ''))
  console.log('')

  runOnce(exeA)
  runOnce(exeB)

  const acc = { a: { wall: [], rss: [], scen: {} }, b: { wall: [], rss: [], scen: {} } }
  const arms = [['a', exeA], ['b', exeB]]
  for (let i = 0; i < RUNS; i++) {
    for (const arm of arms) {
      const tag = arm[0]
      const r = runOnce(arm[1])
      acc[tag].wall.push(r.wallMs)
      if (r.end) acc[tag].rss.push(r.end.maxRSSkb)
      for (const s of r.scenarios) {
        const d = (acc[tag].scen[s.name] ??= { thr: [], cpu: [], rss: [], ops: [] })
        d.thr.push(s.throughputOpsPerSec)
        d.cpu.push(s.cpuTimeMs)
        d.rss.push(s.maxRSSkb)
        d.ops.push(s.opsCount)
      }
    }
    process.stdout.write('  run ' + (i + 1) + '/' + RUNS + ' done\n')
  }
  const after = machineState('after')

  const pad = (s, n) => String(s).padEnd(n)
  const num = (n, d) => Number(n).toFixed(d === undefined ? 3 : d)
  console.log('')
  console.log(pad('scenario', 14) + pad('metric', 10) + pad('A median', 14) + pad('B median', 14) + pad('B/A', 9) + 'spreadA%  spreadB%')
  const rows = []
  for (const n of Object.keys(acc.a.scen)) {
    const metrics = [['thr', 'thr', 'higher'], ['cpuMs', 'cpu', 'lower'], ['rssKB', 'rss', 'lower']]
    for (const mm of metrics) {
      const A = acc.a.scen[n][mm[1]]
      const B = acc.b.scen[n][mm[1]]
      const ma = median(A)
      const mb = median(B)
      rows.push({ scenario: n, metric: mm[0], aMedian: ma, bMedian: mb, ratio: ma ? mb / ma : 0, spreadA: spread(A), spreadB: spread(B), better: mm[2] })
      console.log(pad(n, 14) + pad(mm[0], 10) + pad(num(ma, 1), 14) + pad(num(mb, 1), 14) + pad(num(ma ? mb / ma : 0, 4), 9) + pad(num(spread(A), 2), 10) + num(spread(B), 2))
    }
  }
  const wa = median(acc.a.wall)
  const wb = median(acc.b.wall)
  const ra = median(acc.a.rss)
  const rb = median(acc.b.rss)
  console.log(pad('WHOLE', 14) + pad('wallMs', 10) + pad(num(wa, 1), 14) + pad(num(wb, 1), 14) + pad(num(wb / wa, 4), 9) + pad(num(spread(acc.a.wall), 2), 10) + num(spread(acc.b.wall), 2))
  console.log(pad('WHOLE', 14) + pad('peakRSSkb', 10) + pad(num(ra, 1), 14) + pad(num(rb, 1), 14) + pad(num(rb / ra, 4), 9) + pad(num(spread(acc.a.rss), 2), 10) + num(spread(acc.b.rss), 2))
  console.log(pad('WHOLE', 14) + pad('exeBytes', 10) + pad(szA, 14) + pad(szB, 14) + num(szB / szA, 4))
  console.log('')
  console.log('machine after: cpu ' + after.cpuLoadPercent + '%  node ' + after.nodeProcesses + '  zig ' + after.zigProcesses + '  clang ' + after.clangProcesses + '  free ' + after.freeMemMiB + ' MiB')
  console.log('NOTE: thr higher is better; cpuMs / rssKB / wallMs lower is better.')

  if (JSONOUT) {
    writeFileSync(JSONOUT, JSON.stringify({
      schema: 'scriptc-ab-strpool/1', bench: BENCH, runs: RUNS, minMs: MINMS, only: ONLY || null,
      a: { label: A_LABEL, cflags: A_CFLAGS, exe: exeA, bytes: szA, sha256_16: hA },
      b: { label: B_LABEL, cflags: B_CFLAGS, exe: exeB, bytes: szB, sha256_16: hB },
      byteIdentical: hA === hB,
      machine: { before, after },
      rows,
      whole: { wallMs: { a: wa, b: wb, ratio: wb / wa }, peakRSSkb: { a: ra, b: rb, ratio: rb / ra }, exeBytes: { a: szA, b: szB } },
      raw: acc
    }, null, 2))
    console.log('wrote ' + JSONOUT)
  }
}
main()
