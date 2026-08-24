/**
 * ab-cpu.mjs - a CPU instrument for two compiled binaries, and a
 * CALIBRATION of how small a CPU difference it can actually see.
 *
 * ---------------------------------------------------------------------
 * WHY A SECOND A/B DRIVER
 * ---------------------------------------------------------------------
 * ab-strpool.mjs already alternates two binaries and prints an A/A noise
 * floor, and its RSS column resolves to a tenth of a percent. Its CPU
 * column does not, and the reason is not that the host is noisy. It is
 * that the number it reads is not a measurement.
 *
 * process.cpuUsage() is GetProcessTimes() on both lanes. GetProcessTimes
 * reports SCHEDULER TICKS CHARGED: the timer interrupt fires every
 * 15.625 ms on this host and charges the whole tick to whatever thread it
 * catches. One time-boxed messaging run, measured 2026-08-24:
 *
 *     cpuTimeMs = 1828.125   1937.5   2171.875   1984.375
 *
 * = 117, 124, 139, 127 ticks. Every value an exact multiple, no remainder,
 * on four independent scenarios. So the old column has two defects:
 *
 *   QUANTIZATION - it cannot express anything below 15.625 ms.
 *   SAMPLING     - "ticks charged" is a binomial draw, not a measurement.
 *                  Over n ticks with the process on-CPU a fraction p of
 *                  the time, its variance is n*p*(1-p) - so it gets
 *                  NOISIER exactly when the host gets busier, and none of
 *                  that noise is in the program being measured.
 *
 * This driver replaces it with QueryProcessCycleTime, read from OUTSIDE
 * the child by tests/perf/cpuprobe/cpuprobe.c. That counter is maintained
 * per thread from the invariant TSC and updated at every context switch,
 * so it has neither defect. Read cpuprobe.c's header for what it does and
 * does not claim - in particular it is a high-resolution CPU-TIME counter,
 * not a hardware performance counter, and a downclocked core reports MORE
 * of its "cycles" for identical work.
 *
 * ---------------------------------------------------------------------
 * THE FOUR THINGS THIS DOES DIFFERENTLY, and what each is for
 * ---------------------------------------------------------------------
 * 1. PER-SCENARIO FIXED WORK.  ab-strpool's --batches is one global
 *    number, and the messaging scenarios differ in cost per batch by
 *    200x: SEND 1:1 runs 2057 batches in 2000 ms, SEND group runs 10.
 *    A single --batches therefore either starves one scenario or runs
 *    another for four minutes, and every fixed-work A/B across scenarios
 *    this repo has done compared unlike things. The batch count here is
 *    PER SCENARIO (see WORK below) and --work-scale moves all of them
 *    together, so doubling the work is one flag rather than four guesses.
 *
 * 2. ONE SCENARIO PER PROCESS.  The external counter sees a process, not
 *    a region, so attribution needs either markers inside the child (which
 *    means trusting the child's stdout buffering to flush at the instant
 *    the marker is printed - it does not) or one scenario per process.
 *    BENCH_ONLY already existed for the profiler's benefit; it is reused
 *    here and there is no plumbing inside the child at all.
 *
 * 3. PAIRED, ABBA-ORDERED REPETITIONS.  Arms alternate, and the order
 *    FLIPS every repetition (A,B then B,A), so a linear drift in machine
 *    load over the run cancels to first order instead of landing on
 *    whichever arm went first. Ratios are then formed WITHIN a pair and
 *    the ratios are summarised - not medians formed within each arm and
 *    then divided, which throws the pairing away.
 *
 * 4. AN INJECTED, KNOWN DIFFERENCE.  --inject P runs arm B with P% more
 *    batches. Nothing about the code differs; the extra work is exact and
 *    known. Sweeping P = 0, 1, 2, 5, 10 turns "what is the noise floor"
 *    into the question that actually matters: AT WHAT SIZE DOES THIS
 *    INSTRUMENT START TO SEE A REAL DIFFERENCE, and does it report the
 *    right size when it does. A floor is one point on that curve (P=0).
 *
 *    This is the self-test, and it is the shape of self-test this repo
 *    needed and did not have. --aa alone can only ever show the
 *    instrument saying "nothing"; an instrument that says "nothing" to
 *    everything passes --aa perfectly. --inject makes it prove it can
 *    say something, and say the right thing.
 *
 * ---------------------------------------------------------------------
 * WHAT IS REPORTED
 * ---------------------------------------------------------------------
 * Four estimators over the same samples, side by side, because which one
 * resolves is an empirical question and guessing it wrong is how a floor
 * gets believed:
 *
 *   medianOfPairedRatios   median over reps of (B_i / A_i)
 *   ratioOfMedians         what ab-strpool does today
 *   ratioOfMins            min over reps of each arm, then divided.
 *                          Contention only ADDS CPU to a fixed-work run,
 *                          so the minimum estimates the uncontended cost
 *                          and a busy host mostly cannot corrupt it.
 *   ratioOfTrimmedMeans    mean after dropping the top and bottom 20%
 *
 * and for each, the metric it was computed on:
 *   cycles      QueryProcessCycleTime, whole child process   <- the point
 *   procCpuUs   GetProcessTimes user+kernel, read externally <- the old
 *                                                               counter,
 *                                                               kept for
 *                                                               comparison
 *   inCpuMs     the child's OWN process.cpuUsage() for the scenario
 *   wallNs      QueryPerformanceCounter around the child
 *   peakWSkb    PeakWorkingSetSize, read externally
 *
 * Runs nothing but the exe lane. Node is not comparable here: the counter
 * is read on the child process and Node's child is a different program.
 *
 * ---------------------------------------------------------------------
 *   node tests/perf/ab-cpu.mjs --aa --reps 15 --scenario "SEND 1:1"
 *   node tests/perf/ab-cpu.mjs --aa --inject 2 --reps 15 --scenario "SEND 1:1"
 *   node tests/perf/ab-cpu.mjs --a "" --b "-DSCR_POOL_DEPTH=1024" --reps 15
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { cpus, totalmem, freemem, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireToolchain, toolchainLine } from './toolchain.mjs'
import { buildCpuprobe, cpuprobePath } from './cpuprobe/build.mjs'

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
const has = (n) => argv.includes('--' + n)

/* Per-scenario batch counts, each ~2 s of exe time as measured on this
 * host on 2026-08-24 (SEND 1:1 2057 batches / RECV 1:1 1765 / SEND group
 * 10 / RECV group 1314 in 2000 ms). They are a STARTING POINT, not a
 * constant of the universe: --work-scale multiplies all of them, and the
 * driver prints the wall time each one actually took so a reader can see
 * whether the scale still holds on their host. */
const WORK = {
  'SEND 1:1': 2000,
  'RECV 1:1': 1750,
  'SEND group': 9,
  'RECV group': 1300
}

const BENCH = flag('bench', 'messaging')
const REPS = Number.parseInt(flag('reps', '15'), 10)
const WARMUP = Number.parseInt(flag('warmup', '2'), 10)
const SCENARIO = flag('scenario', 'SEND 1:1')
const WORK_SCALE = Number(flag('work-scale', '1'))
/* --calibrate-ms replaces the WORK table with a measurement. The table
 * above is four numbers taken on one host on one day, and a batch count
 * that was 2 s here is 6 s on a slower box and 0.4 s on a faster one -
 * which changes the floor, silently. With --calibrate-ms the driver runs
 * ONE time-boxed process first and uses the batch count that process
 * actually reached, so the work size is a property of the host it is
 * measured on rather than of the host this file was written on. */
const CALIBRATE_MS = Number.parseInt(flag('calibrate-ms', '0'), 10)
let BATCHES = Number.parseInt(flag('batches', String(Math.max(1, Math.round((WORK[SCENARIO] ?? 1000) * WORK_SCALE)))), 10)
const INJECT = Number(flag('inject', '0'))
const PRIORITY = Number.parseInt(flag('priority', '0'), 10)
const AFFINITY = flag('affinity', '0')
const POLL_US = Number.parseInt(flag('poll-us', '500'), 10)
const OUTDIR = flag('exe-dir', path.join(tmpdir(), 'scr-abcpu'))
const PROBEDIR = flag('probe-dir', path.join(tmpdir(), 'scr-cpuprobe'))
const A_CFLAGS = flag('a', '')
const B_CFLAGS = flag('b', '')
const A_LABEL = flag('label-a', A_CFLAGS || 'base')
const B_LABEL = flag('label-b', B_CFLAGS || 'base')
const JSONOUT = flag('json', null)
const NOBUILD = has('no-build')
const AA = has('aa')
const NOTE = flag('note', '')

if (!(REPS > 0)) { console.error('--reps must be positive'); process.exit(2) }
if (!(BATCHES > 0)) { console.error('--batches must be positive'); process.exit(2) }
if (INJECT !== 0 && !AA) {
  console.error('--inject changes the WORK of arm B, not its code. It is only')
  console.error('meaningful with --aa, where both arms are the same binary and')
  console.error('the injected work is therefore the ONLY difference.')
  process.exit(2)
}

let injectedBatches = Math.round(BATCHES * (1 + INJECT / 100))

// -- machine state -----------------------------------------------------
// Every number below is a property of the host as much as of the code, so
// the host is recorded rather than assumed quiet. The fleet's normal state
// swings between one agent reading source and three compiling; "quiet"
// without a number attached means nothing.
function machineState(label) {
  const ps = spawnSync('powershell', ['-NoProfile', '-Command',
    '$c=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; ' +
    '$n=(Get-Process | Measure-Object).Count; ' +
    '$node=(Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count; ' +
    '$zig=(Get-Process zig -ErrorAction SilentlyContinue | Measure-Object).Count; ' +
    'Write-Output "$c|$n|$node|$zig"'], { encoding: 'utf8' })
  const p = (ps.stdout || '').trim().split('|')
  return {
    label, at: new Date().toISOString(),
    cpuLoadPercent: Number(p[0]), processCount: Number(p[1]),
    nodeProcesses: Number(p[2]), zigProcesses: Number(p[3]),
    freeMemMiB: Math.round(freemem() / 1048576), totalMemMiB: Math.round(totalmem() / 1048576),
    logicalCpus: cpus().length
  }
}

/* codeIdentity - a PE hash that ignores what the LINKER stamps per link:
 * the COFF TimeDateStamp, the optional-header CheckSum, and the debug
 * directory with the CodeView record it points at (GUID and .pdb path).
 * Nothing in .text/.rdata/.data/.pdata/.reloc is masked. Two binaries that
 * agree here agree on all their code and data. Lifted deliberately
 * unchanged from ab-strpool.mjs so the two drivers cannot disagree about
 * what "the same binary" means. */
function codeIdentity(file) {
  let buf
  try { buf = readFileSync(file) } catch { return null }
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return null
  const peOff = buf.readUInt32LE(0x3c)
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return null
  const coff = peOff + 4
  const optSize = buf.readUInt16LE(coff + 16)
  const opt = coff + 20
  const plus = buf.readUInt16LE(opt) === 0x20b
  const secOff = opt + optSize
  const nSections = buf.readUInt16LE(coff + 2)
  const sections = []
  for (let i = 0; i < nSections; i++) {
    const o = secOff + i * 40
    if (o + 40 > buf.length) return null
    sections.push({ rva: buf.readUInt32LE(o + 12), rawSize: buf.readUInt32LE(o + 16), rawPtr: buf.readUInt32LE(o + 20) })
  }
  const fileOffOf = (rva) => {
    for (const s of sections) if (s.rawSize && rva >= s.rva && rva < s.rva + s.rawSize) return s.rawPtr + (rva - s.rva)
    return -1
  }
  const masked = [[coff + 4, 4], [opt + 64, 4]]
  const nDD = buf.readUInt32LE(opt + (plus ? 108 : 92))
  const ddOff = opt + (plus ? 112 : 96)
  if (nDD > 6) {
    const dbgRva = buf.readUInt32LE(ddOff + 6 * 8)
    const dbgSize = buf.readUInt32LE(ddOff + 6 * 8 + 4)
    const dbgOff = dbgRva ? fileOffOf(dbgRva) : -1
    if (dbgOff >= 0 && dbgSize > 0) {
      masked.push([dbgOff, dbgSize])
      for (let e = 0; e + 28 <= dbgSize; e += 28) {
        const rec = dbgOff + e
        const sz = buf.readUInt32LE(rec + 16)
        const ptr = buf.readUInt32LE(rec + 24)
        if (ptr > 0 && sz > 0 && ptr + sz <= buf.length) masked.push([ptr, sz])
      }
    }
  }
  const copy = Buffer.from(buf)
  let maskedBytes = 0
  for (const [off, len] of masked) {
    if (off < 0 || off + len > copy.length) continue
    copy.fill(0, off, off + len)
    maskedBytes += len
  }
  return { hash: createHash('sha256').update(copy).digest('hex').slice(0, 16), maskedBytes }
}

function build(tag, cflags) {
  mkdirSync(OUTDIR, { recursive: true })
  const out = path.join(OUTDIR, BENCH + '-' + tag + '.exe')
  if (NOBUILD && existsSync(out)) return out
  const env = { ...process.env, SCRIPTC_NO_CACHE: '1' }
  if (cflags) env.SCRIPTC_PROF_CFLAGS = cflags
  else delete env.SCRIPTC_PROF_CFLAGS
  try { rmSync(out, { force: true }) } catch { /* nothing to remove */ }
  const t = process.hrtime.bigint()
  const res = spawnSync(process.execPath, [CLI, 'build', BENCH + '.bench.ts', '--backend', 'c', '-o', out],
    { cwd: BENCH_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env })
  if (res.status !== 0) {
    process.stderr.write((res.stdout ?? '').slice(-4000))
    process.stderr.write((res.stderr ?? '').slice(-4000))
    throw new Error('build failed for ' + tag)
  }
  // The target was deleted above, so its EXISTENCE is the proof this build
  // made it. NOT an mtime test: the build cache restores a linked binary
  // with its original mtime and a cache hit would read as stale.
  if (!existsSync(out)) throw new Error('build for ' + tag + ' reported success but wrote no ' + out)
  if (statSync(out).size === 0) throw new Error('build for ' + tag + ' wrote a ZERO-BYTE ' + out)
  console.log('  built ' + tag + ' in ' + (Number(process.hrtime.bigint() - t) / 1e9).toFixed(1) + 's -> ' + out)
  return out
}

// -- one measured process ---------------------------------------------
// batches === 0 means "run under the CLOCK, not the batch bound" and is
// used only by the calibration probe.
function runOnce(probe, exe, batches, scenario, timeBoxMs = 0) {
  const args = ['--priority', String(PRIORITY), '--poll-us', String(POLL_US)]
  if (AFFINITY !== '0') args.push('--affinity', AFFINITY)
  args.push('--', exe)
  const env = {
    ...process.env,
    BENCH_LANE: 'exe',
    // The time bound must be OFF for fixed work. _bench.ts stops on
    // `elapsed < minMs && batches < maxBatches`, so leaving BENCH_MIN_MS at
    // its 2000 default silently keeps the clock in charge and the work is
    // not fixed at all - ab-strpool hit exactly this and reported a 54%
    // within-arm RSS spread on ONE binary because of it.
    BENCH_MIN_MS: timeBoxMs > 0 ? String(timeBoxMs) : '86400000',
    BENCH_MAX_BATCHES: timeBoxMs > 0 ? '1000000000' : String(batches)
  }
  if (scenario) env.BENCH_ONLY = scenario
  const res = spawnSync(probe, args, { cwd: BENCH_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env })
  if (res.status !== 0) {
    process.stderr.write((res.stdout ?? '').slice(0, 4000))
    process.stderr.write((res.stderr ?? '').slice(0, 4000))
    throw new Error(exe + ' under cpuprobe exited ' + res.status)
  }
  let probeRec = null
  for (const line of (res.stderr ?? '').split('\n')) {
    const s = line.trim()
    if (s.startsWith('CPUPROBE ')) probeRec = JSON.parse(s.slice('CPUPROBE '.length))
  }
  if (!probeRec) throw new Error('cpuprobe printed no CPUPROBE line for ' + exe)
  const scenarios = []
  let end = null
  for (const line of (res.stdout ?? '').split('\n')) {
    const s = line.trim()
    if (s.startsWith('SCBENCH {')) scenarios.push(JSON.parse(s.slice('SCBENCH '.length)))
    else if (s.startsWith('SCBENCH-END ')) end = JSON.parse(s.slice('SCBENCH-END '.length))
  }
  if (scenario && scenarios.length !== 1) {
    throw new Error(`BENCH_ONLY=${scenario} produced ${scenarios.length} SCBENCH lines, expected exactly 1`)
  }
  // FIXED WORK, checked rather than asserted in a comment.
  for (const s of scenarios) {
    if (timeBoxMs > 0) continue
    if (s.batches !== batches) {
      throw new Error(`${s.name}: ran ${s.batches} batches, asked for ${batches} - work is NOT fixed`)
    }
  }
  return { probe: probeRec, scenario: scenarios[0] ?? null, end }
}

// -- statistics --------------------------------------------------------
const sorted = (v) => [...v].sort((a, b) => a - b)
function median(v) {
  const s = sorted(v)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function trimmedMean(v, frac = 0.2) {
  const s = sorted(v)
  const k = Math.floor(s.length * frac)
  const t = s.slice(k, s.length - k)
  const use = t.length ? t : s
  return use.reduce((a, b) => a + b, 0) / use.length
}
const spreadPct = (v) => { const m = median(v); return m > 0 ? ((Math.max(...v) - Math.min(...v)) / m) * 100 : 0 }
// Relative median absolute deviation: robust, and unlike (max-min) it does
// not get decided by one preempted run out of fifteen. Both are printed
// because the difference between them IS the information about outliers.
function rmadPct(v) {
  const m = median(v)
  if (!(m > 0)) return 0
  return (median(v.map((x) => Math.abs(x - m))) / m) * 100
}

/* Four estimators of B/A over paired samples. They are all printed because
 * which of them resolves on this host is an empirical question, and the
 * way a floor gets believed is by picking one in advance. */
function estimators(a, b) {
  const n = Math.min(a.length, b.length)
  const pairRatios = []
  for (let i = 0; i < n; i++) if (a[i] > 0) pairRatios.push(b[i] / a[i])
  const ma = median(a), mb = median(b)
  const na = Math.min(...a), nb = Math.min(...b)
  const ta = trimmedMean(a), tb = trimmedMean(b)
  return {
    medianOfPairedRatios: pairRatios.length ? median(pairRatios) : NaN,
    pairedRatioSpreadPct: pairRatios.length ? spreadPct(pairRatios) : NaN,
    ratioOfMedians: ma > 0 ? mb / ma : NaN,
    ratioOfMins: na > 0 ? nb / na : NaN,
    ratioOfTrimmedMeans: ta > 0 ? tb / ta : NaN,
    // The sign test: how many pairs had B above A. Under a true null this
    // is a coin flip, and an estimator claiming a 2% win while the sign
    // count sits at 8/15 is claiming it from the tails.
    bAbovePairs: pairRatios.filter((r) => r > 1).length,
    pairs: pairRatios.length,
    a: { median: ma, min: na, trimmedMean: ta, spreadPct: spreadPct(a), rmadPct: rmadPct(a), n: a.length },
    b: { median: mb, min: nb, trimmedMean: tb, spreadPct: spreadPct(b), rmadPct: rmadPct(b), n: b.length }
  }
}

// -- main --------------------------------------------------------------
function main() {
  const tc = requireToolchain()
  const probe = NOBUILD && existsSync(cpuprobePath(PROBEDIR))
    ? cpuprobePath(PROBEDIR)
    : buildCpuprobe(PROBEDIR, { quiet: true })

  const before = machineState('before')
  console.log('ab-cpu - external CPU instrument (QueryProcessCycleTime), bench=' + BENCH)
  console.log('  scenario   ' + JSON.stringify(SCENARIO) + '   batches ' + BATCHES +
    (INJECT ? '   arm B injected +' + INJECT + '% -> ' + injectedBatches + ' batches' : ''))
  console.log('  reps ' + REPS + ' paired (ABBA-ordered), ' + WARMUP + ' discarded warmup per arm')
  console.log('  A = ' + A_LABEL + '   B = ' + (AA ? A_LABEL + ' (SAME BINARY)' : B_LABEL))
  console.log('  cpuprobe   ' + probe + '   priority=' + PRIORITY + ' affinity=' + AFFINITY + ' pollUs=' + POLL_US)
  console.log('  ' + toolchainLine(tc))
  if (NOTE) console.log('  note: ' + NOTE)
  console.log('machine before: cpu ' + before.cpuLoadPercent + '%  procs ' + before.processCount +
    '  node ' + before.nodeProcesses + '  zig ' + before.zigProcesses + '  free ' + before.freeMemMiB + ' MiB')
  console.log('')

  const exeA = build('a', A_CFLAGS)
  const exeB = AA ? exeA : build('b', B_CFLAGS)
  const cA = codeIdentity(exeA)
  const cB = codeIdentity(exeB)
  const codeIdentical = !!(cA && cB && cA.hash === cB.hash)
  console.log('  A ' + statSync(exeA).size + ' bytes  code ' + (cA ? cA.hash : '(not a PE)'))
  console.log('  B ' + statSync(exeB).size + ' bytes  code ' + (cB ? cB.hash : '(not a PE)'))
  console.log('  code identity: ' + (codeIdentical ? 'IDENTICAL' : 'DIFFERS'))
  if (AA && !codeIdentical) {
    console.error('  ** --aa is comparing a binary with ITSELF and codeIdentity says DIFFERS.')
    console.error('  ** The identity check is broken; nothing this run prints can be trusted.')
    process.exit(3)
  }
  console.log('')

  if (CALIBRATE_MS > 0) {
    const probeRun = runOnce(probe, exeA, 0, SCENARIO, CALIBRATE_MS)
    if (!probeRun.scenario) throw new Error('calibration probe produced no scenario line')
    BATCHES = Math.max(1, probeRun.scenario.batches)
    injectedBatches = Math.round(BATCHES * (1 + INJECT / 100))
    console.log('  calibration: ' + CALIBRATE_MS + ' ms of ' + JSON.stringify(SCENARIO) +
      ' is ' + BATCHES + ' batches on this host (measured, not tabulated)')
  }
  if (INJECT !== 0 && injectedBatches === BATCHES) {
    console.error(`--inject ${INJECT} rounds to ZERO extra batches at --batches ${BATCHES}.`)
    console.error(`Raise --work-scale or --calibrate-ms until ${BATCHES} * ${1 + INJECT / 100} lands on a`)
    console.error('different integer, or the point you are about to measure is an A/A in disguise.')
    process.exit(2)
  }

  const batchesA = BATCHES
  const batchesB = INJECT ? injectedBatches : BATCHES
  if (INJECT !== 0) {
    console.log('  injection: A ' + batchesA + ' batches, B ' + batchesB + ' batches = +' +
      ((batchesB / batchesA - 1) * 100).toFixed(3) + '% WORK, identical code')
  }

  for (let w = 0; w < WARMUP; w++) {
    runOnce(probe, exeA, batchesA, SCENARIO)
    runOnce(probe, exeB, batchesB, SCENARIO)
  }

  const METRICS = ['cycles', 'procCpuUs', 'inCpuMs', 'wallNs', 'peakWSkb', 'inRssKb']
  const acc = { a: {}, b: {} }
  for (const t of ['a', 'b']) for (const m of METRICS) acc[t][m] = []
  const probeFlags = { postExitOk: new Set(), qpct: new Set(), polledEqualsPostExit: 0, samples: 0 }

  const record = (tag, r) => {
    const p = r.probe
    const cyc = p.postExitOk ? p.cyclesPostExit : p.cyclesPolled
    acc[tag].cycles.push(cyc)
    acc[tag].procCpuUs.push(p.userUs + p.kernelUs)
    acc[tag].inCpuMs.push(r.scenario ? r.scenario.cpuTimeMs : 0)
    acc[tag].wallNs.push(p.wallNs)
    acc[tag].peakWSkb.push(p.peakWSkb)
    acc[tag].inRssKb.push(r.scenario ? r.scenario.maxRSSkb : 0)
    probeFlags.postExitOk.add(p.postExitOk)
    probeFlags.qpct.add(p.qpctAvailable)
    probeFlags.samples++
    if (p.postExitOk && p.cyclesPolled > 0 && p.cyclesPostExit >= p.cyclesPolled) probeFlags.polledEqualsPostExit++
  }

  for (let i = 0; i < REPS; i++) {
    // ABBA: even reps run A first, odd reps run B first. A monotone drift
    // in host load over the session then lands on both arms equally
    // instead of on whichever one always went first.
    const order = i % 2 === 0 ? ['a', 'b'] : ['b', 'a']
    for (const tag of order) {
      const r = tag === 'a' ? runOnce(probe, exeA, batchesA, SCENARIO) : runOnce(probe, exeB, batchesB, SCENARIO)
      record(tag, r)
    }
    process.stdout.write('  rep ' + (i + 1) + '/' + REPS + ' (' + order.join('') + ')\r')
  }
  console.log('  ' + REPS + ' reps done' + ' '.repeat(20))
  const after = machineState('after')

  const est = {}
  for (const m of METRICS) est[m] = estimators(acc.a[m], acc.b[m])

  const pad = (s, n) => String(s).padEnd(n)
  const pc = (r) => Number.isFinite(r) ? ((r - 1) * 100).toFixed(3) + '%' : 'n/a'
  console.log('')
  console.log('B/A as a percentage difference, by metric and by estimator' +
    (INJECT ? '   (TRUE ANSWER: +' + ((batchesB / batchesA - 1) * 100).toFixed(3) + '%)' : ''))
  console.log(pad('metric', 11) + pad('pairedMed', 12) + pad('medians', 12) + pad('mins', 12) +
    pad('trimMean', 12) + pad('spreadA%', 10) + pad('spreadB%', 10) + pad('rmadA%', 9) + 'B>A')
  for (const m of METRICS) {
    const e = est[m]
    console.log(pad(m, 11) + pad(pc(e.medianOfPairedRatios), 12) + pad(pc(e.ratioOfMedians), 12) +
      pad(pc(e.ratioOfMins), 12) + pad(pc(e.ratioOfTrimmedMeans), 12) +
      pad(e.a.spreadPct.toFixed(2), 10) + pad(e.b.spreadPct.toFixed(2), 10) +
      pad(e.a.rmadPct.toFixed(2), 9) + e.bAbovePairs + '/' + e.pairs)
  }

  console.log('')
  console.log('absolute medians:')
  for (const m of METRICS) {
    console.log('  ' + pad(m, 11) + ' A ' + pad(est[m].a.median.toFixed(0), 16) + ' B ' + est[m].b.median.toFixed(0))
  }
  const wallSec = median(acc.a.wallNs) / 1e9
  console.log('  one measured process took ' + wallSec.toFixed(2) + ' s wall; ' +
    (REPS * 2 + WARMUP * 2) + ' processes in this run')

  /* ---- the floor / the verdict ------------------------------------ */
  const floorMetrics = ['cycles', 'procCpuUs', 'inCpuMs', 'wallNs', 'peakWSkb']
  const verdict = {}
  for (const m of floorMetrics) {
    const e = est[m]
    verdict[m] = {
      pairedMedianPct: (e.medianOfPairedRatios - 1) * 100,
      minsPct: (e.ratioOfMins - 1) * 100,
      mediansPct: (e.ratioOfMedians - 1) * 100
    }
  }
  console.log('')
  if (AA && INJECT === 0) {
    console.log('NOISE FLOOR (A/A: one binary, same work, so every number above is noise):')
    for (const m of floorMetrics) {
      const v = verdict[m]
      console.log('  ' + pad(m, 11) + ' |pairedMed-1| ' + pad(Math.abs(v.pairedMedianPct).toFixed(3) + '%', 10) +
        ' |mins-1| ' + pad(Math.abs(v.minsPct).toFixed(3) + '%', 10) +
        ' |medians-1| ' + Math.abs(v.mediansPct).toFixed(3) + '%')
    }
    console.log('  Read this as: a later A/B move smaller than the number in the column')
    console.log('  you intend to quote has measured NOTHING.')
  } else if (AA && INJECT !== 0) {
    const truePct = (batchesB / batchesA - 1) * 100
    console.log('CALIBRATION (arm B did +' + truePct.toFixed(3) + '% work; the code is identical):')
    for (const m of floorMetrics) {
      const v = verdict[m]
      const err = (e) => (e - truePct).toFixed(3)
      console.log('  ' + pad(m, 11) + ' pairedMed ' + pad(v.pairedMedianPct.toFixed(3) + '%', 10) +
        '(err ' + pad(err(v.pairedMedianPct), 8) + ') mins ' + pad(v.minsPct.toFixed(3) + '%', 10) +
        '(err ' + err(v.minsPct) + ')')
    }
    console.log('  An instrument that cannot recover an injection it KNOWS the size of')
    console.log('  cannot be trusted with one whose size is the question.')
    /* THE INJECTION'S OWN VALIDITY CHECK.
     * "+P% batches is +P% work" is true only if the cost of a batch does
     * not depend on how many came before it, and on the messaging bench it
     * DOES: SEND 1:1 never clears its Map, so more batches mean a larger
     * hash table, and crossing a doubling threshold changes the cost per
     * batch discontinuously. Measured here at --inject 5 on SEND 1:1:
     * peak working set rose 12.7% for 5% more batches, and CPU rose ~11%.
     * Nothing was wrong with the instrument; the CALIBRATION POINT was
     * invalid, and an instrument that cannot notice that will report its
     * own substrate's non-linearity as an error in itself.
     * Peak RSS is the check because it is the one near-exact column here
     * (A/A spread 0.03%), so a divergence between it and the injected
     * ratio is about the workload, not about noise.
     *
     * THE TEST IS ONE-SIDED, and the first version of it was not. Written
     * as |rss - injected| > 1pp it fired on numeric-modulo, where peak RSS
     * moved 0.000% for +1.966% batches - correctly, since that scenario
     * allocates NOTHING and its footprint cannot depend on the batch
     * count. A guard that fires on the clean substrate is worse than no
     * guard: it teaches the reader to ignore it. What is diagnostic is
     * peak RSS growing FASTER than the work, because a footprint that
     * outruns its own workload means state is carrying across batches. */
    const rssPct = (est.peakWSkb.medianOfPairedRatios - 1) * 100
    if (rssPct - truePct > 1) {
      console.log('')
      console.log('  ** THIS CALIBRATION POINT IS NOT CLEAN. Peak working set moved ' + rssPct.toFixed(3) +
        '% for +' + truePct.toFixed(3) + '% batches.')
      console.log('  ** Peak RSS resolves to ~0.03% here, so that gap is the WORKLOAD, not the counter:')
      console.log('  ** this scenario\'s cost per batch is not constant, so "+' + truePct.toFixed(3) +
        '% batches" is not "+' + truePct.toFixed(3) + '% work"')
      console.log('  ** and the errors printed above are measured against a TRUE ANSWER THAT IS WRONG.')
      console.log('  ** Calibrate on a scenario whose per-batch cost carries no state across batches.')
    }
  } else {
    console.log('A/B RATIOS (this is NOT a floor - run --aa in the same session for one):')
    for (const m of floorMetrics) {
      const v = verdict[m]
      console.log('  ' + pad(m, 11) + ' pairedMed ' + pad(v.pairedMedianPct.toFixed(3) + '%', 10) +
        ' mins ' + pad(v.minsPct.toFixed(3) + '%', 10) + ' medians ' + v.mediansPct.toFixed(3) + '%')
    }
  }

  console.log('')
  console.log('probe health: QueryProcessCycleTime available=' + [...probeFlags.qpct].join(',') +
    '  post-exit read ok=' + [...probeFlags.postExitOk].join(',') +
    '  post-exit >= last poll on ' + probeFlags.polledEqualsPostExit + '/' + probeFlags.samples + ' samples')
  if (probeFlags.qpct.has(false)) {
    console.log('  ** QueryProcessCycleTime was NOT available. The cycles column is zero and is NOT a measurement.')
  }
  console.log('machine after : cpu ' + after.cpuLoadPercent + '%  procs ' + after.processCount +
    '  node ' + after.nodeProcesses + '  zig ' + after.zigProcesses + '  free ' + after.freeMemMiB + ' MiB')

  if (JSONOUT) {
    writeFileSync(JSONOUT, JSON.stringify({
      schema: 'scriptc-ab-cpu/1',
      bench: BENCH, scenario: SCENARIO, batchesA, batchesB, injectPct: INJECT,
      reps: REPS, warmup: WARMUP, priority: PRIORITY, affinity: AFFINITY, pollUs: POLL_US,
      aa: AA, note: NOTE || null,
      a: { label: A_LABEL, cflags: A_CFLAGS, exe: exeA, code16: cA?.hash ?? null },
      b: { label: AA ? A_LABEL : B_LABEL, cflags: AA ? A_CFLAGS : B_CFLAGS, exe: exeB, code16: cB?.hash ?? null },
      codeIdentical, toolchain: tc, machine: { before, after },
      estimators: est, verdict, probeHealth: {
        qpctAvailable: [...probeFlags.qpct], postExitOk: [...probeFlags.postExitOk],
        postExitGeLastPoll: probeFlags.polledEqualsPostExit, samples: probeFlags.samples
      },
      raw: acc
    }, null, 2))
    console.log('wrote ' + JSONOUT)
  }
}

main()
