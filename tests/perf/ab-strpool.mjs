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
 * Self-test rule: run it with the SAME flags on both arms first. If it
 * cannot report "identical" when nothing differs, its "identical" means
 * nothing when something does.
 *
 * THE SELF-TEST AS ORIGINALLY WRITTEN COULD NOT FIRE, and that is worth
 * spelling out because it is the exact failure the rule exists to catch.
 * It compared whole-file SHA-256s and told the reader that an inert -D
 * "produces BYTE-IDENTICAL binaries". It never does and never could: the
 * two arms are linked to `<bench>-a.exe` and `<bench>-b.exe`, and a PE
 * carries its .pdb path and a build GUID inside the debug directory, so
 * the file hashes differ for the filename alone. Measured on this host,
 * base against base, same source, two output names: 21 bytes differ out of
 * 655,360 - four at the COFF TimeDateStamp and seventeen in the CodeView
 * record. Building the SAME source to the SAME path twice IS byte-exact.
 *
 * So the identity test now ignores the two regions a PE stamps per link
 * (`codeIdentity`, below) and reports CODE-IDENTICAL, which an A/A does
 * reach. Whole-file SHA-256 is still printed, because the difference
 * between the two answers is itself information.
 *
 * --aa is the honest noise floor: ONE binary, run in BOTH slots. No second
 * build, no -D, nothing for a compiler to do differently - every ratio it
 * prints is pure run-to-run noise, and the NOISE FLOOR line is the largest
 * of them. A later A/B whose ratio is inside that band has measured
 * nothing. Take the floor in the same session as the comparison: it is a
 * property of how busy the machine is, not of the code.
 *
 *   node tests/perf/ab-strpool.mjs --runs 9 --aa            # the floor, FIRST
 *   node tests/perf/ab-strpool.mjs --runs 9 --a "" --b "-DSCR_POOL_DEPTH=1024"
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { cpus, totalmem, freemem } from 'node:os'
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
  return v === undefined ? d : v
}
const BENCH = flag('bench', 'messaging')
const RUNS = Number.parseInt(flag('runs', '9'), 10)
const ONLY = flag('only', '')
const BATCHES = flag('batches', '')
/* --batches asks for FIXED WORK, and fixed work is the only shape in which
 * peak RSS means anything (a time-boxed arm that is faster does MORE work
 * and reports MORE memory for it - estado-strpool nearly filed that as a
 * 50% regression). But _bench.ts stops on `elapsed < minMs && batches <
 * maxBatches`, so an unchanged min-ms of 2000 silently keeps the TIME
 * bound in force and the work is not fixed after all. Measured here: at
 * --batches 2400 the SEND 1:1 arm ran out its 2000 ms first and peak RSS
 * spread was 54.55% within one arm - on ONE binary run against itself.
 * So when --batches is given and --min-ms is not, the time bound is
 * removed. Pass both explicitly to get the old behaviour back. */
const MINMS = flag('min-ms', BATCHES ? '86400000' : '2000')
const OUTDIR = flag('exe-dir', 'G:/zapo-work/caches/strpool/ab')
const A_CFLAGS = flag('a', '')
const B_CFLAGS = flag('b', '')
const A_LABEL = flag('label-a', A_CFLAGS || 'base')
const B_LABEL = flag('label-b', B_CFLAGS || 'base')
const JSONOUT = flag('json', null)
const NOBUILD = argv.includes('--no-build')
// --aa: ONE binary in both slots. The B build is not performed at all, so
// there is nothing for a compiler difference to hide in.
const AA = argv.includes('--aa')

/* ---------------------------------------------------------------------
 * codeIdentity - a PE hash that ignores what the LINKER stamps per link.
 *
 * Masked: the COFF TimeDateStamp, the optional header CheckSum, and every
 * byte the debug data directory owns (the IMAGE_DEBUG_DIRECTORY entries
 * themselves and the CodeView record they point at, which holds the GUID
 * and the .pdb path). Nothing in .text, .rdata, .data, .pdata or .reloc is
 * masked, so two binaries that agree here agree on all of their code and
 * all of their data. Returns null, never a wrong answer, if the file is
 * not a PE this reader understands.
 * ------------------------------------------------------------------- */
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
    for (const s of sections) {
      if (s.rawSize && rva >= s.rva && rva < s.rva + s.rawSize) return s.rawPtr + (rva - s.rva)
    }
    return -1
  }
  const masked = []
  masked.push([coff + 4, 4])                       // TimeDateStamp
  masked.push([opt + 64, 4])                       // CheckSum
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
  // A build that FAILED is not a build that was fast, and a stale .exe
  // left behind by a previous run is the one artefact that can turn a
  // failure into a spectacular win. Delete the target first, then require
  // that the build put a NEW one there.
  try { rmSync(out, { force: true }) } catch { /* nothing to remove */ }
  const t = process.hrtime.bigint()
  const res = spawnSync(process.execPath, [CLI, 'build', BENCH + '.bench.ts', '--backend', 'c', '-o', out],
    { cwd: BENCH_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env })
  if (res.status !== 0) {
    process.stderr.write((res.stdout ?? '').slice(-4000))
    process.stderr.write((res.stderr ?? '').slice(-4000))
    throw new Error('build failed for ' + tag)
  }
  // The target was removed above, so its EXISTENCE now is the proof that
  // this build produced it. Deliberately NOT an mtime test: scriptc's
  // build cache restores a linked binary with its ORIGINAL mtime, so a
  // legitimate cache hit looks older than the build that fetched it. That
  // false positive was found on a real zapo relink whose whole link came
  // back from cache byte-identical with a 106-minute-old timestamp.
  if (!existsSync(out)) throw new Error('build for ' + tag + ' reported success but wrote no ' + out)
  const st = statSync(out)
  if (st.size === 0) throw new Error('build for ' + tag + ' wrote a ZERO-BYTE ' + out)
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
  const tc = requireToolchain()
  const before = machineState('before')
  console.log('A/B compiled-binary comparison - bench=' + BENCH + ' runs=' + RUNS + ' BENCH_MIN_MS=' + MINMS)
  console.log('  A = ' + A_LABEL + '   [' + (A_CFLAGS || '(no extra cflags)') + ']')
  console.log('  B = ' + B_LABEL + '   [' + (B_CFLAGS || '(no extra cflags)') + ']')
  console.log(toolchainLine(tc))
  console.log('machine before: cpu ' + before.cpuLoadPercent + '%  procs ' + before.processCount +
    '  node ' + before.nodeProcesses + '  zig ' + before.zigProcesses + '  clang ' + before.clangProcesses +
    '  free ' + before.freeMemMiB + ' MiB')
  if (before.cpuLoadPercent > 25) {
    console.log('  ** WARNING: machine is NOT quiet (cpu ' + before.cpuLoadPercent + '%). Numbers below are suspect. **')
  }
  console.log('')

  const exeA = build('a', A_CFLAGS)
  // --aa runs ONE binary in both slots: same path, same bytes, same inode.
  // Nothing can differ, so every ratio printed below is noise by
  // construction and the driver is entitled to call the largest of them a
  // floor.
  const exeB = AA ? exeA : build('b', B_CFLAGS)
  const szA = statSync(exeA).size
  const szB = statSync(exeB).size
  const hA = sha(exeA)
  const hB = sha(exeB)
  const cA = codeIdentity(exeA)
  const cB = codeIdentity(exeB)
  const codeIdentical = !!(cA && cB && cA.hash === cB.hash)
  console.log('  A .exe ' + szA + ' bytes  sha ' + hA + '  code ' + (cA ? cA.hash : '(not a PE)'))
  console.log('  B .exe ' + szB + ' bytes  sha ' + hB + '  code ' + (cB ? cB.hash : '(not a PE)'))
  console.log('  identity: file ' + (hA === hB ? 'IDENTICAL' : 'differs') +
    ', code ' + (codeIdentical ? 'IDENTICAL' : 'DIFFERS') +
    (cA ? '  (' + cA.maskedBytes + ' bytes masked: TimeDateStamp, CheckSum, debug directory)' : ''))
  if (AA && !codeIdentical) {
    console.error('  ** --aa is comparing a binary with ITSELF and codeIdentity still says DIFFERS.')
    console.error('  ** The identity check is broken. Nothing this run prints can be trusted.')
    process.exit(3)
  }
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
        const d = (acc[tag].scen[s.name] ??= { thr: [], cpu: [], rss: [], ops: [], batches: [] })
        d.thr.push(s.throughputOpsPerSec)
        d.cpu.push(s.cpuTimeMs)
        d.rss.push(s.maxRSSkb)
        d.ops.push(s.opsCount)
        d.batches.push(s.batches)
      }
    }
    process.stdout.write('  run ' + (i + 1) + '/' + RUNS + ' done\n')
  }
  const after = machineState('after')

  /* ---- the fixed-work assertion ------------------------------------ *
   * If --batches was asked for, every run of every scenario in every arm
   * must have executed exactly that many batches. If any did not, the
   * time bound won and the run is time-boxed, which makes peak RSS
   * circular. Say so loudly rather than printing a memory ratio that
   * measures how busy the machine was.
   * ------------------------------------------------------------------ */
  let workFixed = null
  if (BATCHES) {
    const want = Number.parseInt(BATCHES, 10)
    const bad = []
    for (const tag of ['a', 'b']) {
      for (const [n, d] of Object.entries(acc[tag].scen)) {
        const off = d.batches.filter((x) => x !== want)
        if (off.length) bad.push(tag + '/' + n + ': ' + off.length + '/' + d.batches.length +
          ' runs stopped at ' + [...new Set(off)].join(',') + ' of ' + want + ' batches')
      }
    }
    workFixed = bad.length === 0
    console.log('')
    if (workFixed) {
      console.log('fixed work CONFIRMED: every scenario ran exactly ' + want + ' batches in both arms.')
    } else {
      console.log('** WORK WAS NOT FIXED - the time bound (BENCH_MIN_MS=' + MINMS + ') bound first:')
      for (const line of bad) console.log('   ' + line)
      console.log('   peak RSS below is CIRCULAR (a faster arm does more work and reports more memory).')
    }
  }

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

  /* ---- the floor -------------------------------------------------- *
   * Every ratio above, expressed as |ratio - 1|. Under --aa the two arms
   * ARE the same binary, so the largest of these is the smallest effect
   * this bench can distinguish from nothing on this machine right now.
   * Printed for an A/B too, where it is not a floor but is still the
   * number a reader needs to see beside a claimed win.
   * ---------------------------------------------------------------- */
  const devs = rows.map((r) => ({ what: r.scenario + ' ' + r.metric, dev: Math.abs(r.ratio - 1) }))
  devs.push({ what: 'WHOLE wallMs', dev: Math.abs(wb / wa - 1) })
  devs.push({ what: 'WHOLE peakRSSkb', dev: Math.abs(rb / ra - 1) })
  devs.sort((x, y) => y.dev - x.dev)
  const floor = devs[0]
  const byMetric = {}
  for (const r of rows) {
    const m = byMetric[r.metric] ??= { dev: 0, what: '' }
    const d = Math.abs(r.ratio - 1)
    if (d > m.dev) { m.dev = d; m.what = r.scenario }
  }
  console.log(AA ? 'NOISE FLOOR (A/A - one binary in both slots, so every number below is noise):'
                 : 'RATIO SPREAD for this A/B (NOT a floor - run --aa in this session to get one):')
  for (const [metric, m] of Object.entries(byMetric)) {
    console.log('  ' + metric.padEnd(10) + ' worst |ratio-1| = ' + (m.dev * 100).toFixed(2) + '%   (' + m.what + ')')
  }
  console.log('  ' + 'wallMs'.padEnd(10) + ' worst |ratio-1| = ' + (Math.abs(wb / wa - 1) * 100).toFixed(2) + '%')
  console.log('  ' + 'peakRSS'.padEnd(10) + ' worst |ratio-1| = ' + (Math.abs(rb / ra - 1) * 100).toFixed(2) + '%')
  console.log('  ' + (AA ? 'FLOOR' : 'WORST').padEnd(10) + ' = ' + (floor.dev * 100).toFixed(2) + '%  on ' + floor.what)
  if (AA) {
    console.log('  exeBytes ratio ' + (szB / szA).toFixed(4) + ' -- size is the ONE exact instrument here; ' +
      'a size delta of any magnitude is real, a throughput or RSS delta under the floor is not.')
  }
  console.log('')
  console.log('machine after: cpu ' + after.cpuLoadPercent + '%  node ' + after.nodeProcesses + '  zig ' + after.zigProcesses + '  clang ' + after.clangProcesses + '  free ' + after.freeMemMiB + ' MiB')
  console.log('NOTE: thr higher is better; cpuMs / rssKB / wallMs lower is better.')

  if (JSONOUT) {
    writeFileSync(JSONOUT, JSON.stringify({
      schema: 'scriptc-ab-strpool/1', bench: BENCH, runs: RUNS, minMs: MINMS, only: ONLY || null,
      aa: AA,
      a: { label: A_LABEL, cflags: A_CFLAGS, exe: exeA, bytes: szA, sha256_16: hA, code16: cA?.hash ?? null },
      b: { label: AA ? A_LABEL : B_LABEL, cflags: AA ? A_CFLAGS : B_CFLAGS, exe: exeB, bytes: szB, sha256_16: hB, code16: cB?.hash ?? null },
      byteIdentical: hA === hB,
      codeIdentical,
      noiseFloor: { worst: floor, byMetric, allDeviations: devs },
      fixedWork: workFixed,
      toolchain: tc,
      machine: { before, after },
      rows,
      whole: { wallMs: { a: wa, b: wb, ratio: wb / wa }, peakRSSkb: { a: ra, b: rb, ratio: rb / ra }, exeBytes: { a: szA, b: szB } },
      raw: acc
    }, null, 2))
    console.log('wrote ' + JSONOUT)
  }
}
main()
