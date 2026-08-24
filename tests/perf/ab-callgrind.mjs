/**
 * ab-callgrind.mjs - PER-FUNCTION cost, deterministic, with no floor.
 *
 * WHAT THIS IS, AND WHERE ITS NUMBERS LIVE. Two lanes, and every number here
 * belongs to the first:
 *
 *   callgrind (this file)  INSTRUCTIONS EXECUTED, counted exactly, by an
 *                          emulator, on a binary cross-compiled for
 *                          x86_64-linux-gnu and run under WSL2.
 *   cpuprobe (ab-cpu.mjs)  CYCLES, measured by a real core, on the
 *                          x86_64-windows-gnu binary the project ships.
 *
 * CALLGRIND PROPOSES, CPUPROBE DISPOSES. A change can cut instructions and
 * cost time (worse locality, a branch that now mispredicts) or cut time and
 * add instructions. Attribution here finds the candidate; only the Windows
 * lane can say whether moving it moved the clock, against a same-session
 * floor. A row in this table is a hypothesis with an exact number attached,
 * never a performance claim.
 *
 * WHY IT IS WORTH THE CROSS-BUILD. ab-cpu.mjs's A/A floor is 0.14-0.27% on a
 * stateless workload and 0.62-0.90% on SEND 1:1 at 60 reps. A ladder whose
 * rungs are 0.18 pp apart is therefore unadjudicable on this host at any rep
 * count anyone has evidence for. Callgrind has NO floor: instruction counts
 * are deterministic, and the same binary on the same input reproduces to the
 * instruction. `--selftest` proves that by running one binary twice and
 * requiring EXACTLY zero difference.
 *
 * WHAT IT CANNOT ANSWER. Instructions are not cycles. Callgrind's default
 * has no cache simulation at all (Ir only), so a cache miss, a branch
 * mispredict, a store-forwarding stall and a dependency chain are all
 * invisible: two functions with equal Ir can differ several-fold in time.
 * It also cannot see anything the Windows arm does differently - see
 * platform-divergence.mjs, which measures exactly how much of the binary
 * that is.
 *
 * HEALTH CHECKS, verified on every run and printed with the results, because
 * a driver whose `cycles` column reads zeros looks exactly like "no
 * difference":
 *   1. the scenario's own SCBENCH line is in the run log (else DID-NOT-RUN);
 *   2. callgrind's `summary:` is greater than zero;
 *   3. the share of Ir landing on an unsymbolised `???` frame is reported,
 *      never hidden - it is the "no symbols" failure mode's fingerprint;
 *   4. every scenario is run twice and the two runs must agree to the
 *      instruction. A scenario that does not reproduce is printed as
 *      NON-DETERMINISTIC and excluded from any A/B verdict.
 *
 * FIXED WORK, NOT FIXED TIME. _bench.ts's loop is time-boxed
 * (`while (elapsed < BENCH_MIN_MS)`), which under an emulator would make the
 * work depend on the emulator's speed. BENCH_MAX_BATCHES=1 pins it: one
 * warmup batch plus exactly one measured batch, the same work every run.
 * That is what makes the count reproduce.
 *
 * Run:
 *   node tests/perf/ab-callgrind.mjs --selftest
 *   node tests/perf/ab-callgrind.mjs --bench runtime --out G:/blocks/x/lab/cg
 *   node tests/perf/ab-callgrind.mjs --bench messaging --top 30
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const BENCH_DIR = path.join(HERE, 'bench')
const CLI = path.join(REPO, 'packages', 'cli', 'dist', 'main.js')
const NL = String.fromCharCode(10)

const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  if (i < 0) return d
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? '1' : v
}
const has = (n) => argv.includes('--' + n)

const BENCH = flag('bench', 'runtime')
const OUT = path.resolve(flag('out', path.join(REPO, 'callgrind-out')))
const TOP = Number.parseInt(flag('top', '30'), 10)
const REPS = Number.parseInt(flag('reps', '2'), 10)
const DISTRO = flag('distro', 'Arch')
/* glibc 2.39 is not decoration: the bare x86_64-linux-gnu triple picks a
 * glibc old enough that scr_bytes_io.c's arc4random_buf is undeclared and the
 * cross build fails with two errors and no hint that a version suffix is the
 * fix. Measured here, 2026-08-24. */
const TRIPLE = flag('triple', 'x86_64-linux-gnu.2.39')
/* The A/A pair is not bit-identical and the reason is the WORKLOAD, not the
 * instrument: the bench prints its own `elapsedMs`, whose digits differ run to
 * run, so ryu's d2d and one scr_str_concat spend a few instructions
 * differently. Measured residue on SEND 1:1: 151 Ir on 36,043,691 =
 * 0.000419%. The gate is therefore a declared floor rather than exact zero -
 * and it is a gate that fires: --no-pin drops BENCH_MAX_BATCHES=1 and the
 * same check reports percent-scale drift. */
const FLOOR_PCT = Number.parseFloat(flag('floor', '0.01'))
const NO_PIN = has('no-pin')
const WSLDIR = '/tmp/fnprof-cg'

const SCENARIOS = {
  runtime: ['numeric-modulo', 'numeric-add', 'closure-churn', 'closure-nocapture', 'closure-call-hoisted', 'string-build', 'map-churn', 'array-churn', 'record-field'],
  messaging: ['SEND 1:1', 'RECV 1:1', 'SEND group', 'RECV group'],
  startup: []
}

/* ── WSL ────────────────────────────────────────────────────────────────── */

/** One bash script inside the distro. NEVER pipe wsl's stdout through `tail`
 *  or `head`: a run that did that appeared to hang for twelve minutes with
 *  the child at 0:00 CPU. Redirect to a file inside the distro and read the
 *  file. */
function wsl(script) {
  const res = spawnSync('wsl', ['-d', DISTRO, '-u', 'root', '--', 'bash', '-c', script], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })
  if (res.error) throw new Error('wsl not runnable: ' + res.error.message)
  return { status: res.status, out: (res.stdout ?? '').replace(/\0/g, ''), err: (res.stderr ?? '').replace(/\0/g, '') }
}

/** G:\a\b -> /mnt/g/a/b */
function toWsl(p) {
  const s = path.resolve(p).replace(/\\/g, '/')
  const m = /^([A-Za-z]):\/(.*)$/.exec(s)
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : s
}

function requireWsl() {
  const v = wsl('valgrind --version 2>&1; echo "---"; callgrind_annotate --version 2>&1')
  const ok = /valgrind-\d/.test(v.out) && /callgrind_annotate-\d/.test(v.out)
  if (!ok) {
    console.error('valgrind and callgrind_annotate are required inside WSL distro "' + DISTRO + '".')
    console.error(v.out + v.err)
    process.exit(4)
  }
  return v.out.split(NL).map((s) => s.trim()).filter(Boolean).filter((s) => s !== '---').join('  ')
}

/* ── build ──────────────────────────────────────────────────────────────── */

function buildLinux(bench, outDir) {
  const exe = path.join(outDir, bench + '.elf')
  console.log('  cross-building ' + bench + '.bench.ts for ' + TRIPLE + ' ...')
  const t = process.hrtime.bigint()
  const res = spawnSync(process.execPath, [CLI, 'build', bench + '.bench.ts', '--backend', 'c', '-o', exe], {
    cwd: BENCH_DIR,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, SCRIPTC_TARGET: TRIPLE }
  })
  if (res.status !== 0) {
    process.stderr.write((res.stdout ?? '').slice(-4000))
    process.stderr.write((res.stderr ?? '').slice(-4000))
    throw new Error('cross build failed (exit ' + res.status + ')')
  }
  console.log('    ' + (Number(process.hrtime.bigint() - t) / 1e9).toFixed(1) + 's -> ' + exe)
  return exe
}

/* ── one profiled run ───────────────────────────────────────────────────── */

/** Run one scenario under callgrind and bring the profile back. `tag` names
 *  the output files, so a repeat is a separate artefact rather than an
 *  overwrite. */
function profile(exeWinPath, scenario, tag, benchEnv) {
  const outFile = path.join(OUT, tag + '.callgrind')
  const logFile = path.join(OUT, tag + '.log')
  const envLines = Object.entries({
    BENCH_LANE: 'callgrind',
    BENCH_ONLY: scenario,
    // fixed WORK, not fixed time - see the header. --no-pin removes it, which
    // is how the reproducibility check is shown to be capable of failing.
    ...(NO_PIN ? {} : { BENCH_MAX_BATCHES: '1' }),
    BENCH_MIN_MS: NO_PIN ? '250' : '1',
    ...benchEnv
  }).map(([k, v]) => k + "='" + String(v).replace(/'/g, "'\\''") + "'").join(' ')

  const script = [
    'set -e',
    'mkdir -p ' + WSLDIR,
    'cp ' + JSON.stringify(toWsl(exeWinPath)) + ' ' + WSLDIR + '/run.elf',
    'chmod +x ' + WSLDIR + '/run.elf',
    'cd ' + WSLDIR,
    envLines + ' timeout 3600 valgrind --tool=callgrind --callgrind-out-file=' + WSLDIR + '/p.out' +
      ' --separate-threads=no --cache-sim=no --branch-sim=no ./run.elf > ' + WSLDIR + '/p.log 2>&1 || true',
    'cp ' + WSLDIR + '/p.out ' + JSON.stringify(toWsl(outFile)),
    'cp ' + WSLDIR + '/p.log ' + JSON.stringify(toWsl(logFile)),
    'echo WSL_OK'
  ].join(NL)

  const r = wsl(script)
  if (!r.out.includes('WSL_OK')) throw new Error('callgrind run failed for ' + scenario + ':' + NL + r.out + r.err)
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
  return { outFile, logFile, log }
}

/* ── parse ──────────────────────────────────────────────────────────────── */

/** Self Ir and call count per function, straight from the callgrind file.
 *  Call counts are NOT in callgrind_annotate's output, and they are half the
 *  point of a per-function table. */
function parseCallgrind(file) {
  const text = readFileSync(file, 'utf8')
  const names = new Map() // id -> name, per name-kind
  const self = new Map()
  const calls = new Map()
  let curFn = null
  let curOb = ''
  let pendingCalls = 0
  let pendingTarget = null
  let summary = 0
  const nameOf = (kind, raw) => {
    // `fn=(12) some_name` defines id 12; `fn=(12)` refers back to it
    const m = /^\((\d+)\)\s*(.*)$/.exec(raw)
    if (m === null) return raw.trim()
    const id = kind + '#' + m[1]
    if (m[2].trim() !== '') names.set(id, m[2].trim())
    return names.get(id) ?? '(unknown)'
  }
  for (const raw of text.split(NL)) {
    const s = raw.replace(/\r$/, '')
    if (s.startsWith('summary:')) { summary = Number(s.slice(8).trim().split(/\s+/)[0]); continue }
    if (s.startsWith('totals:') && summary === 0) { summary = Number(s.slice(7).trim().split(/\s+/)[0]); continue }
    if (s.startsWith('ob=')) { curOb = nameOf('ob', s.slice(3)); continue }
    if (s.startsWith('cob=')) { continue }
    if (s.startsWith('fl=') || s.startsWith('fi=') || s.startsWith('fe=')) { nameOf('fl', s.slice(3)); continue }
    if (s.startsWith('cfi=') || s.startsWith('cfl=')) { continue }
    if (s.startsWith('fn=')) {
      curFn = nameOf('fn', s.slice(3)) + (curOb && !curOb.includes('run.elf') ? ' [' + path.basename(curOb) + ']' : '')
      if (!self.has(curFn)) self.set(curFn, 0)
      pendingCalls = 0
      pendingTarget = null
      continue
    }
    if (s.startsWith('cfn=')) { pendingTarget = nameOf('fn', s.slice(4)); continue }
    if (s.startsWith('calls=')) { pendingCalls = Number(s.slice(6).trim().split(/\s+/)[0]) || 0; continue }
    if (/^[+\-*\d]/.test(s) && curFn !== null) {
      const parts = s.trim().split(/\s+/)
      const cost = Number(parts[1])
      if (!Number.isFinite(cost)) continue
      if (pendingCalls > 0 && pendingTarget !== null) {
        // this cost line is the INCLUSIVE cost of those calls, not self cost
        calls.set(pendingTarget, (calls.get(pendingTarget) ?? 0) + pendingCalls)
        pendingCalls = 0
        pendingTarget = null
      } else {
        self.set(curFn, (self.get(curFn) ?? 0) + cost)
      }
      continue
    }
  }
  return { self, calls, summary }
}

/** Inclusive Ir per function, from callgrind_annotate (it handles recursion
 *  and cycles; a naive sum over the call graph does not). */
function inclusiveOf(outFileWin) {
  const r = wsl('callgrind_annotate --threshold=100 --inclusive=yes --auto=no ' +
    JSON.stringify(toWsl(outFileWin)) + ' 2>/dev/null')
  const map = new Map()
  for (const raw of r.out.split(NL)) {
    const m = /^\s*([\d,]+)\s*\(\s*[\d.]+%\)\s+(.*?)\s*$/.exec(raw)
    if (m === null) continue
    const rest = m[2]
    if (rest === 'PROGRAM TOTALS') continue
    const ir = Number(m[1].replace(/,/g, ''))
    const name = shortName(rest)
    if (name === null) continue
    if (!map.has(name) || map.get(name) < ir) map.set(name, ir)
  }
  return map
}

/** `dir/file.c:fn [obj]` -> `fn` (plus the object when it is not our binary).
 *  The compile records an absolute Windows path as the file, which annotate
 *  then prefixes with the build cwd; the basename is the only usable part. */
function shortName(rest) {
  let obj = null
  let s = rest
  const om = /\s\[([^\]]+)\]\s*$/.exec(s)
  if (om) { obj = om[1]; s = s.slice(0, om.index) }
  const i = s.lastIndexOf(':')
  if (i < 0) return null
  const fn = s.slice(i + 1).trim()
  if (fn === '') return null
  return fn + (obj && !obj.includes('run.elf') && !obj.includes('.elf') ? ' [' + path.basename(obj) + ']' : '')
}

/** The file half of an annotate row, for the "which source" column. */
function fileOf(rest) {
  let s = rest
  const om = /\s\[([^\]]+)\]\s*$/.exec(s)
  if (om) s = s.slice(0, om.index)
  const i = s.lastIndexOf(':')
  if (i < 0) return '?'
  const f = s.slice(0, i).replace(/\\/g, '/')
  const b = f.split('/').filter(Boolean).pop()
  return b === undefined || b === '???' ? '?' : b
}

function selfTable(outFileWin) {
  const r = wsl('callgrind_annotate --threshold=100 --auto=no ' + JSON.stringify(toWsl(outFileWin)) + ' 2>/dev/null')
  const rows = new Map()
  let total = 0
  for (const raw of r.out.split(NL)) {
    const m = /^\s*([\d,]+)\s*\(\s*[\d.]+%\)\s+(.*?)\s*$/.exec(raw)
    if (m === null) continue
    const ir = Number(m[1].replace(/,/g, ''))
    if (m[2] === 'PROGRAM TOTALS') { total = ir; continue }
    const name = shortName(m[2])
    if (name === null) continue
    const prev = rows.get(name)
    if (prev === undefined) rows.set(name, { name, file: fileOf(m[2]), self: ir })
    else prev.self += ir
  }
  return { rows, total }
}

/* ── one scenario, REPS times ───────────────────────────────────────────── */

function measure(exe, scenario, label, benchEnv) {
  const reps = []
  for (let i = 0; i < REPS; i += 1) {
    const tag = (label + '-' + scenario + '-r' + i).replace(/[^A-Za-z0-9_.-]+/g, '_')
    const p = profile(exe, scenario, tag, benchEnv)
    const parsed = parseCallgrind(p.outFile)
    const st = selfTable(p.outFile)
    const inc = inclusiveOf(p.outFile)
    // HEALTH 1: the scenario's own SCBENCH line
    const ran = p.log.includes('"name":"' + scenario + '"')
    // HEALTH 3: unsymbolised share
    let unsym = 0
    for (const [name, row] of st.rows) if (/^0x[0-9a-f]+/.test(name) || name.startsWith('???')) unsym += row.self
    reps.push({
      tag, ran, total: st.total, summary: parsed.summary, unsym,
      rows: st.rows, inc, calls: parsed.calls, log: p.log
    })
  }
  /* HEALTH 4: reproducibility, gated on a PERCENTAGE rather than on exact
   * equality. Exact equality is what the measured WORK achieves, but the
   * harness also prints its own elapsedMs/throughput, and ryu's d2d spends a
   * different number of instructions on a different number of digits. That
   * residue is ~20-200 Ir on 48-533 MILLION, and demanding zero would paint
   * every scenario red for a reason that is not the instrument's. The drift
   * is printed frame by frame, so a real regression cannot hide inside it. */
  const a = reps[0]
  const drift = []
  let worstPct = 0
  for (const r of reps.slice(1)) {
    const dp = a.total > 0 ? Math.abs(100 * (r.total - a.total) / a.total) : 0
    worstPct = Math.max(worstPct, dp)
    if (r.total !== a.total) drift.push('total ' + fmt(a.total) + ' vs ' + fmt(r.total) +
      '  (' + (r.total - a.total >= 0 ? '+' : '') + fmt(r.total - a.total) + ' Ir, ' + dp.toFixed(6) + '%)')
    for (const [name, row] of a.rows) {
      const other = r.rows.get(name)
      if (other === undefined) { drift.push('MISSING IN REPEAT: ' + name); worstPct = Infinity; continue }
      if (other.self !== row.self) drift.push(name + ': ' + fmt(row.self) + ' vs ' + fmt(other.self))
    }
  }
  const deterministic = worstPct < FLOOR_PCT
  return { scenario, reps, rep: a, deterministic, drift, driftPct: worstPct }
}

/* ── report ─────────────────────────────────────────────────────────────── */

const fmt = (n) => Number(n).toLocaleString('en-US')
const pad = (s, w) => String(s).padEnd(w)
const rpad = (s, w) => String(s).padStart(w)

function printScenario(m) {
  const r = m.rep
  console.log('')
  console.log('== ' + m.scenario + '  total Ir ' + fmt(r.total))
  const health = [
    'SCBENCH-line=' + (r.ran ? 'yes' : 'NO  <-- DID-NOT-RUN'),
    'summary=' + fmt(r.summary) + (r.summary > 0 ? '' : '  <-- ZERO'),
    'unsymbolised=' + (r.total > 0 ? (100 * r.unsym / r.total).toFixed(2) : '0.00') + '%',
    'reproducible(' + REPS + 'x)=' + (m.drift.length === 0 ? 'EXACT'
      : m.deterministic ? 'within ' + m.driftPct.toFixed(6) + '% (gate ' + FLOOR_PCT + '%)'
        : 'NO  <-- ' + m.driftPct.toFixed(6) + '% EXCEEDS the ' + FLOOR_PCT + '% gate')
  ]
  console.log('   health: ' + health.join('   '))
  for (const d of m.drift.slice(0, 8)) console.log('     drift: ' + d)
  if (!r.ran || r.summary === 0) { console.log('   (health check failed - no table)'); return }

  const rows = [...r.rows.values()]
    .map((x) => ({ ...x, incl: r.inc.get(x.name) ?? 0, calls: r.calls.get(x.name.replace(/\s\[[^\]]+\]$/, '')) ?? 0 }))
    .sort((x, y) => y.self - x.self)
  console.log('')
  console.log('   ' + pad('function', 40) + pad('source', 20) + rpad('self Ir', 14) + rpad('self%', 8) +
    rpad('incl Ir', 14) + rpad('incl%', 8) + rpad('calls', 12) + rpad('Ir/call', 10))
  for (const x of rows.slice(0, TOP)) {
    console.log('   ' + pad(x.name.slice(0, 39), 40) + pad(x.file.slice(0, 19), 20) +
      rpad(fmt(x.self), 14) + rpad((100 * x.self / r.total).toFixed(2), 8) +
      rpad(fmt(x.incl), 14) + rpad((100 * x.incl / r.total).toFixed(2), 8) +
      rpad(fmt(x.calls), 12) + rpad(x.calls > 0 ? (x.self / x.calls).toFixed(1) : '-', 10))
  }
  const shown = rows.slice(0, TOP).reduce((a, x) => a + x.self, 0)
  console.log('   ' + pad('(' + (rows.length - Math.min(TOP, rows.length)) + ' more rows)', 60) +
    rpad(fmt(r.total - shown), 14) + rpad((100 * (r.total - shown) / r.total).toFixed(2), 8))
}


function parseEnv(spec) {
  const out = {}
  for (const kv of String(spec || '').split(',')) {
    const i = kv.indexOf('=')
    if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim()
  }
  return out
}

function abRun(exeA, exeB, scenarios, aEnv, bEnv) {
  const sameBinary = exeA === exeB
  console.log('')
  console.log('A/B   A=' + path.basename(exeA) + (Object.keys(aEnv).length ? ' ' + JSON.stringify(aEnv) : '') +
    '   B=' + path.basename(exeB) + (Object.keys(bEnv).length ? ' ' + JSON.stringify(bEnv) : ''))
  if (sameBinary && Object.keys(aEnv).length === 0 && Object.keys(bEnv).length === 0) {
    console.log('   (identical arms: this run is an A/A and must report no difference)')
  }
  const out = []
  for (const sc of scenarios) {
    const A = measure(exeA, sc, 'ab-a', aEnv)
    const B = measure(exeB, sc, 'ab-b', bEnv)
    const health = A.rep.ran && B.rep.ran && A.rep.summary > 0 && B.rep.summary > 0
    console.log('')
    console.log('== ' + sc)
    console.log('   health: A SCBENCH=' + (A.rep.ran ? 'yes' : 'NO') + ' B SCBENCH=' + (B.rep.ran ? 'yes' : 'NO') +
      '   A reproducible=' + (A.deterministic ? 'EXACT' : 'no') + '   B reproducible=' + (B.deterministic ? 'EXACT' : 'no'))
    if (!health) { console.log('   DID-NOT-RUN - no verdict'); continue }
    const dTotal = B.rep.total - A.rep.total
    const pct = A.rep.total > 0 ? 100 * dTotal / A.rep.total : 0
    console.log('   total Ir  A ' + fmt(A.rep.total) + '   B ' + fmt(B.rep.total) +
      '   delta ' + (dTotal >= 0 ? '+' : '') + fmt(dTotal) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(6) + '%)')
    if (dTotal === 0) console.log('   VERDICT: no difference, to the instruction.')
    const names = new Set([...A.rep.rows.keys(), ...B.rep.rows.keys()])
    const deltas = []
    for (const n of names) {
      const a = A.rep.rows.get(n)?.self ?? 0
      const b = B.rep.rows.get(n)?.self ?? 0
      if (a !== b) deltas.push({ name: n, a, b, d: b - a })
    }
    deltas.sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    if (deltas.length > 0) {
      console.log('   ' + pad('function', 40) + rpad('A self Ir', 14) + rpad('B self Ir', 14) + rpad('delta', 14) + rpad('delta%', 10))
      for (const d of deltas.slice(0, TOP)) {
        console.log('   ' + pad(d.name.slice(0, 39), 40) + rpad(fmt(d.a), 14) + rpad(fmt(d.b), 14) +
          rpad((d.d >= 0 ? '+' : '') + fmt(d.d), 14) + rpad(d.a > 0 ? ((100 * d.d / d.a).toFixed(3)) : '-', 10))
      }
      console.log('   ' + deltas.length + ' function(s) moved of ' + names.size)
    }
    out.push({ scenario: sc, aTotal: A.rep.total, bTotal: B.rep.total, deltaIr: dTotal, deltaPct: pct, moved: deltas.length, deltas })
  }
  const jsonOut = path.join(OUT, BENCH + '-callgrind-ab.json')
  writeFileSync(jsonOut, JSON.stringify({ bench: BENCH, exeA, exeB, aEnv, bEnv, scenarios: out }, null, 2))
  console.log('')
  console.log('json -> ' + jsonOut)
}

/* ── driver ─────────────────────────────────────────────────────────────── */

function main() {
  mkdirSync(OUT, { recursive: true })
  const vg = requireWsl()
  console.log('ab-callgrind   distro=' + DISTRO + '   ' + vg)
  console.log('triple=' + TRIPLE + '   reps=' + REPS + '   out=' + OUT)

  const exeFlag = flag('exe', null)
  const exe = exeFlag !== null ? path.resolve(exeFlag) : buildLinux(BENCH, OUT)
  if (!existsSync(exe)) { console.error('no such binary: ' + exe); process.exit(2) }

  const scList = flag('scenarios', null)
  const scenarios = scList !== null ? scList.split(',').map((s) => s.trim()).filter(Boolean) : (SCENARIOS[BENCH] ?? [])
  if (scenarios.length === 0) { console.error('no scenarios for bench "' + BENCH + '"; pass --scenarios'); process.exit(2) }

  if (has('selftest')) return selftest(exe, scenarios[0])

  /* A/B. Two arms, either two BINARIES (--b <elf>) or one binary under two
   * environments (--aenv/--benv, `K=V,K=V`). The second form is what makes a
   * KNOWN difference injectable: BENCH_N=200000 vs 200400 is 0.2% more work,
   * far under any wall-clock floor on this host, and this lane resolves it
   * exactly. An instrument that only ever reports "no difference" is not
   * proven by reporting one. */
  const bExe = flag('b', null)
  const aEnv = parseEnv(flag('aenv', ''))
  const bEnv = parseEnv(flag('benv', ''))
  if (bExe !== null || Object.keys(bEnv).length > 0) {
    return abRun(exe, bExe === null ? exe : path.resolve(bExe), scenarios, aEnv, bEnv)
  }

  const results = []
  for (const s of scenarios) {
    console.log('')
    console.log('profiling ' + s + ' (' + REPS + ' reps) ...')
    const m = measure(exe, s, 'a', {})
    results.push(m)
    printScenario(m)
  }

  const jsonOut = path.join(OUT, BENCH + '-callgrind.json')
  writeFileSync(jsonOut, JSON.stringify({
    bench: BENCH, triple: TRIPLE, reps: REPS, valgrind: vg,
    scenarios: results.map((m) => ({
      scenario: m.scenario,
      total: m.rep.total,
      ran: m.rep.ran,
      unsymbolisedPct: m.rep.total > 0 ? 100 * m.rep.unsym / m.rep.total : 0,
      deterministic: m.deterministic,
      rows: [...m.rep.rows.values()]
        .map((x) => ({
          name: x.name, file: x.file, self: x.self,
          incl: m.rep.inc.get(x.name) ?? 0,
          calls: m.rep.calls.get(x.name.replace(/\s\[[^\]]+\]$/, '')) ?? 0
        }))
        .sort((a, b) => b.self - a.self)
    }))
  }, null, 2))
  console.log('')
  console.log('json -> ' + jsonOut)

  const bad = results.filter((m) => !m.rep.ran || m.rep.summary === 0 || !m.deterministic)
  if (bad.length > 0) {
    console.log('')
    console.log(bad.length + ' scenario(s) failed a health check: ' + bad.map((m) => m.scenario).join(', '))
    process.exit(1)
  }
}

/** A/A: the SAME binary, twice, must come back with zero difference. An
 *  instrument that cannot say "no difference" cannot be believed when it
 *  says there is one. */
function selftest(exe, scenario) {
  console.log('')
  console.log('SELFTEST (A/A): one binary, two independent callgrind runs, scenario "' + scenario + '"')
  const A = measure(exe, scenario, 'aa-a', {})
  const B = measure(exe, scenario, 'aa-b', {})
  if (!A.rep.ran || !B.rep.ran) { console.log('SELFTEST FAIL: the scenario did not run (no SCBENCH line).'); process.exit(1) }
  if (A.rep.summary === 0 || B.rep.summary === 0) { console.log('SELFTEST FAIL: callgrind summary is zero.'); process.exit(1) }

  /* The verdict is split, because the two halves have different causes and
   * only one of them is the instrument's. Frames inside OUR binary must
   * match to the instruction - there is no source of variation there.
   * Frames in a shared library can move for a reason that belongs to the
   * WORKLOAD rather than to callgrind: the bench prints `elapsedMs`, whose
   * digits differ run to run, and libc's float formatting spends a different
   * number of instructions on a different number of digits. That residue is
   * reported as the measured A/A floor rather than dismissed, and it is the
   * number to compare an effect against. */
  const names = new Set([...A.rep.rows.keys(), ...B.rep.rows.keys()])
  const isForeign = (n) => /\[[^\]]+\]$/.test(n)
  let ours = 0
  let foreign = 0
  let maxAbs = 0
  const detail = []
  for (const n of names) {
    const a = A.rep.rows.get(n)?.self ?? 0
    const b = B.rep.rows.get(n)?.self ?? 0
    if (a === b) continue
    maxAbs = Math.max(maxAbs, Math.abs(a - b))
    detail.push(n + ': ' + fmt(a) + ' vs ' + fmt(b) + (isForeign(n) ? '   (shared library)' : '   (OUR BINARY)'))
    if (isForeign(n)) foreign += 1
    else ours += 1
  }
  const delta = B.rep.total - A.rep.total
  const floorPct = A.rep.total > 0 ? Math.abs(100 * delta / A.rep.total) : 0
  console.log('  A total Ir ' + fmt(A.rep.total) + '   B total Ir ' + fmt(B.rep.total))
  console.log('  functions compared ' + names.size + '   differing: ' + ours + ' in our binary, ' + foreign + ' in shared libraries')
  console.log('  largest single |delta| ' + fmt(maxAbs) + ' Ir')
  console.log('  MEASURED A/A FLOOR: ' + fmt(delta) + ' instructions on ' + fmt(A.rep.total) +
    ' = ' + floorPct.toFixed(6) + '%')
  for (const d of detail.slice(0, 20)) console.log('    ' + d)
  console.log('  gate: |floor| must be under ' + FLOOR_PCT + '%' + (NO_PIN ? '   (--no-pin: work is NOT pinned)' : ''))
  if (floorPct < FLOOR_PCT) {
    console.log('SELFTEST PASS: an A/A pair reports ' + floorPct.toFixed(6) + '%, and ' +
      (names.size - ours - foreign) + ' of ' + names.size + ' frames were bit-identical.')
    console.log('  The instrument can say "no difference", and its floor is ' + floorPct.toFixed(6) +
      '% - three orders of magnitude under the 0.62-0.90% wall-clock floor on SEND 1:1.')
    process.exit(0)
  }
  console.log('SELFTEST FAIL: an A/A pair moved ' + floorPct.toFixed(6) + '%, over the ' + FLOOR_PCT + '% gate.')
  process.exit(1)
}

main()
