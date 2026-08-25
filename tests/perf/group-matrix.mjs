/**
 * group-matrix.mjs — the GROUP scenarios, four ways, at per-scenario fixed work.
 *
 * exe-matrix.mjs compares two RUNTIMES for one program. This compares two
 * runtimes AND two STORES for the same program, which is the only shape in
 * which either difference can be attributed:
 *
 *     node + Map        node + SQLite
 *     compiled + Map    compiled + SQLite
 *
 * so "store alone" is a row pair at fixed runtime and "runtime alone" is a
 * column pair at fixed store. A single diagonal (node + Map against
 * compiled + SQLite) changes both at once and is not a measurement of
 * either; tests/perf/exe-matrix.mjs's sibling report says so at length.
 *
 * WHY THIS FILE EXISTS AND exe-matrix.mjs DOES NOT DO IT
 *
 * 1. BENCH_MAX_BATCHES is GLOBAL. One batch of "SEND 1:1" is 1,000 store
 *    writes; one batch of "SEND group" is 1,000 x GROUP_MEMBERS = 500,000.
 *    A single batch count therefore quantises the two scenarios 500x
 *    apart, and the coarser one cannot be given a useful amount of work
 *    without the finer one running for an hour. Here every scenario
 *    carries its OWN batch count, and every row prints the count it used.
 *
 * 2. exe-matrix.mjs's node lane is process.execPath — whichever node is
 *    running the driver. The Node VERSION is not incidental to these
 *    numbers: v22 + Map peaks at 236.5 MiB where v25 + Map peaks at 350.3,
 *    1.48x on heap sizing alone. Here the interpreter is named per row.
 *
 * 3. The store axis needs its own env (BENCH_SQLITE_*), and the SQLite
 *    lane needs a database path that is NOT in the repo.
 *
 * WHAT THE NUMBERS MEAN
 *
 *   peak RSS     PeakWorkingSetSize, the same Windows counter on both
 *                lanes (K32GetProcessMemoryInfo compiled, uv_getrusage on
 *                Node), read as a high-water mark from outside the
 *                process. Near load-independent, so it is quoted as a
 *                number. NOTE it is the TOTAL working set: Task Manager's
 *                default "Memory" column is the PRIVATE working set and
 *                reads lower.
 *   throughput   wall-clock, and wall-clock on a shared host swings up to
 *                2x. Quoted as median AND min-max, never as a bare number.
 *
 * Every run is checked, not assumed:
 *   - exactly ONE scenario came back, so BENCH_ONLY selected (a wrong
 *     variable name yields four identical rows, which is what a broken
 *     filter looks like);
 *   - it ran exactly the batches asked for, so the work really is fixed
 *     and the RSS column is a comparison;
 *   - the SQLite lane's own row counter agrees with a real count(*) on
 *     the table it wrote, so an inert instrument cannot pass as a zero.
 *
 * Run:
 *   node tests/perf/group-matrix.mjs --json out.json --runs 3
 *   node tests/perf/group-matrix.mjs --scenarios "RECV 1:1" --runs 1
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { cpus, freemem, totalmem } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH_DIR = path.join(HERE, 'bench')

const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  if (i < 0) return d
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? '1' : v
}

const RUNS = Number.parseInt(flag('runs', '3'), 10)
const JSONOUT = flag('json', null)
const DBDIR = flag('db-dir', path.join(HERE, '..', '..', '.bench-db'))
const EXEDIR = flag('exe-dir', null)
const TX = flag('tx', '1')
const CACHE = flag('sqlite-cache', '2000')
const BOUND = flag('group-bound', 'tracked')

if (!EXEDIR) {
  console.error('--exe-dir is required: the directory holding messaging.exe and messaging-sqlite.exe')
  process.exit(2)
}

/* Per-scenario fixed work. The numbers are not round for their own sake:
 *
 *   SEND group    one batch is 1,000 messages x 500 members = 500,000
 *                 store writes, and its 200,000-entry bound therefore
 *                 fires every 400 messages — steady state inside the
 *                 first batch. 6 batches = 3,000,000 writes and 15 wipes.
 *                 It is the ceiling the SQLite lane can afford: its keys
 *                 are member-major, so the B-tree is written in RANDOM
 *                 order and a 2 MiB page cache thrashes, at ~18 s/batch.
 *   RECV group    one batch is 1,000 writes and the bound fires every
 *                 200 batches, so anything under ~400 batches never
 *                 exercises the wipe at all and measures a growing table.
 *                 1,000 batches = 1,000,000 writes and 5 wipes.
 *   RECV 1:1      unbounded, like SEND 1:1: 800 batches is the same
 *                 800,000 messages the SEND 1:1 row in
 *                 estado-sqlite.md §4 used, so the two tables line up.
 *   SEND 1:1      carried at its published 800 for continuity.
 */
const BATCHES = {
  'SEND 1:1': 800,
  'RECV 1:1': 800,
  'SEND group': 6,
  'RECV group': 1000
}

const SCENARIOS = flag('scenarios', 'RECV 1:1,SEND group,RECV group')
  .split(',').map((s) => s.trim()).filter(Boolean)
for (const s of SCENARIOS) {
  if (!BATCHES[s]) {
    console.error(`unknown scenario '${s}' (have: ${Object.keys(BATCHES).join(', ')})`)
    process.exit(2)
  }
}

/* The runtimes. A Node lane is an interpreter PATH plus a label, because
 * "node" is not one runtime here. */
const NODE25 = flag('node25', 'C:\\Users\\vinicius\\AppData\\Local\\nvm\\v25.9.0\\node.exe')
const NODE22 = flag('node22', process.execPath)
const WANT = flag('runtimes', 'node25,exe').split(',').map((s) => s.trim())

const RUNTIMES = {
  node25: { label: 'node v25.9.0', kind: 'node', exec: NODE25 },
  node22: { label: 'node v22.18.0', kind: 'node', exec: NODE22 },
  exe: { label: 'compiled', kind: 'exe', exec: null }
}

const STORES = {
  map: { label: 'Map', bench: 'messaging' },
  sqlite: { label: 'SQLite file, batch tx', bench: 'messaging-sqlite' }
}

function machineState(label) {
  const ps = spawnSync('powershell', ['-NoProfile', '-Command',
    '$c=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; ' +
    '$n=(Get-Process | Measure-Object).Count; ' +
    '$node=(Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count; ' +
    '$zig=(Get-Process zig -ErrorAction SilentlyContinue | Measure-Object).Count; ' +
    'Write-Output "$c|$n|$node|$zig"'], { encoding: 'utf8' })
  const [cpu, procs, nodeProcs, zigProcs] = ((ps.stdout || '').trim()).split('|')
  return {
    label, at: new Date().toISOString(),
    cpuLoadPercent: Number(cpu), processCount: Number(procs),
    nodeProcesses: Number(nodeProcs), zigProcesses: Number(zigProcs),
    freeMemMiB: Math.round(freemem() / 1048576),
    totalMemMiB: Math.round(totalmem() / 1048576),
    logicalCpus: cpus().length
  }
}

function runOnce(scenario, runtimeKey, storeKey, runIdx) {
  const rt = RUNTIMES[runtimeKey]
  const st = STORES[storeKey]
  const batches = BATCHES[scenario]

  const dbPath = path.join(DBDIR, `${storeKey}-${runtimeKey}-${scenario.replace(/[^a-z0-9]+/gi, '-')}.db`)
  if (storeKey === 'sqlite') {
    mkdirSync(DBDIR, { recursive: true })
    // WAL and shm siblings survive a crash and would be read back in.
    for (const suf of ['', '-wal', '-shm']) { try { rmSync(dbPath + suf, { force: true }) } catch { /* not there */ } }
  }

  const env = {
    ...process.env,
    BENCH_LANE: rt.kind === 'exe' ? 'exe' : runtimeKey,
    BENCH_ONLY: scenario,
    BENCH_MIN_MS: '86400000',      // the time bound off: --batches alone leaves it in force
    BENCH_MAX_BATCHES: String(batches),
    BENCH_SQLITE_PATH: dbPath,
    BENCH_SQLITE_TX: TX,
    BENCH_SQLITE_CACHE: CACHE,
    BENCH_GROUP_BOUND: BOUND
  }

  const spec = rt.kind === 'exe'
    ? { file: path.join(EXEDIR, st.bench + '.exe'), args: [] }
    : { file: rt.exec, args: ['--experimental-strip-types', path.join(BENCH_DIR, st.bench + '.bench.ts')] }
  if (!existsSync(spec.file)) throw new Error(`missing ${spec.file}`)

  const t0 = process.hrtime.bigint()
  const res = spawnSync(spec.file, spec.args, {
    cwd: BENCH_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env
  })
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6
  if (res.status !== 0) {
    process.stderr.write(res.stdout ?? '')
    process.stderr.write(res.stderr ?? '')
    throw new Error(`${runtimeKey}/${storeKey}/${scenario} exited ${res.status}`)
  }

  const scenarios = []
  let end = null, rows = null
  for (const line of (res.stdout ?? '').split('\n')) {
    const s = line.trim()
    if (s.startsWith('SCBENCH {')) scenarios.push(JSON.parse(s.slice('SCBENCH '.length)))
    else if (s.startsWith('SCBENCH-END ')) end = JSON.parse(s.slice('SCBENCH-END '.length))
    else if (s.startsWith('SCBENCH-ROWS ')) rows = JSON.parse(s.slice('SCBENCH-ROWS '.length))
  }

  // -- the three checks ------------------------------------------------
  if (scenarios.length !== 1) {
    throw new Error(
      `${runtimeKey}/${storeKey}/${scenario}: BENCH_ONLY selected ${scenarios.length} scenarios, ` +
      `not 1 — the filter did not work and these rows are not what they say they are`)
  }
  const sc = scenarios[0]
  if (sc.name !== scenario) throw new Error(`asked for '${scenario}', got '${sc.name}'`)
  if (sc.batches !== batches) {
    throw new Error(
      `${runtimeKey}/${storeKey}/${scenario}: ran ${sc.batches} batches, asked for ${batches} — ` +
      `work is NOT fixed, so peak RSS across lanes means nothing`)
  }
  if (!rows) throw new Error(`${runtimeKey}/${storeKey}/${scenario}: no SCBENCH-ROWS control line`)
  if (!rows.agree) {
    throw new Error(
      `${runtimeKey}/${storeKey}/${scenario}: the store holds ${rows.rowsInTable} entries but the run ` +
      `counted ${rows.rowsTracked} — the bound did not measure what it wrote`)
  }
  if (storeKey === 'sqlite' && rows.rowsInTable === 0) {
    throw new Error(`${runtimeKey}/${scenario}: SQLite table is EMPTY — the lane wrote nothing`)
  }

  let dbBytes = null
  if (storeKey === 'sqlite' && existsSync(dbPath)) dbBytes = statSync(dbPath).size

  return { wallMs, scenario: sc, end, rows, dbPath, dbBytes, runIdx }
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const stats = (v) => v.length ? { median: median(v), min: Math.min(...v), max: Math.max(...v), n: v.length, spreadPct: median(v) > 0 ? ((Math.max(...v) - Math.min(...v)) / median(v)) * 100 : 0 } : null

const fmt = (n) => Math.round(n).toLocaleString('en-US')
const mib = (kb) => (kb / 1024).toFixed(1)

async function main() {
  const started = Date.now()
  const before = machineState('before')
  console.log('group-matrix — the group scenarios, two runtimes x two stores, per-scenario fixed work')
  console.log(`scenarios: ${SCENARIOS.join(' | ')}`)
  console.log(`batches:   ${SCENARIOS.map((s) => `${s}=${BATCHES[s]}`).join('  ')}`)
  console.log(`runtimes:  ${WANT.map((r) => RUNTIMES[r].label).join(', ')}   runs: ${RUNS}`)
  console.log(`sqlite:    tx=${TX} cache=${CACHE} KiB bound=${BOUND}   db dir: ${DBDIR}`)
  console.log(`exe dir:   ${EXEDIR}`)
  console.log(`machine before: cpu ${before.cpuLoadPercent}%  procs ${before.processCount}  node ${before.nodeProcesses}  zig ${before.zigProcesses}  free ${before.freeMemMiB} MiB`)
  console.log('')

  const result = {
    schema: 'scriptc-group-matrix/1',
    startedAt: new Date().toISOString(),
    config: { scenarios: SCENARIOS, batches: BATCHES, runtimes: WANT, runs: RUNS, tx: TX, cache: CACHE, bound: BOUND, exeDir: EXEDIR, dbDir: DBDIR },
    machine: { before },
    cells: {}
  }

  for (const scenario of SCENARIOS) {
    for (const storeKey of ['map', 'sqlite']) {
      for (const rtKey of WANT) {
        const key = `${scenario} | ${STORES[storeKey].label} | ${RUNTIMES[rtKey].label}`
        process.stdout.write(`${key.padEnd(58)} `)
        const runs = []
        for (let i = 0; i < RUNS; i++) {
          const r = runOnce(scenario, rtKey, storeKey, i)
          runs.push(r)
          process.stdout.write(`${fmt(r.scenario.throughputOpsPerSec)}/${mib(r.end.maxRSSkb)}M `)
        }
        result.cells[key] = {
          scenario, store: storeKey, storeLabel: STORES[storeKey].label,
          runtime: rtKey, runtimeLabel: RUNTIMES[rtKey].label,
          batches: BATCHES[scenario], opsCount: runs[0].scenario.opsCount,
          throughput: stats(runs.map((r) => r.scenario.throughputOpsPerSec)),
          maxRSSkb: stats(runs.map((r) => r.end.maxRSSkb)),
          elapsedMs: stats(runs.map((r) => r.scenario.elapsedMs)),
          cpuTimeMs: stats(runs.map((r) => r.scenario.cpuTimeMs)),
          wallMs: stats(runs.map((r) => r.wallMs)),
          rowsInStore: runs[0].rows.rowsInTable,
          dbPath: runs[0].dbPath, dbBytes: runs[0].dbBytes,
          perRun: runs.map((r) => ({
            throughputOpsPerSec: r.scenario.throughputOpsPerSec,
            maxRSSkb: r.end.maxRSSkb, elapsedMs: r.scenario.elapsedMs,
            cpuTimeMs: r.scenario.cpuTimeMs, wallMs: r.wallMs,
            rowsInTable: r.rows.rowsInTable
          }))
        }
        console.log('')
      }
    }
  }

  result.machine.after = machineState('after')
  result.totalWallSec = (Date.now() - started) / 1000

  // -- report ----------------------------------------------------------
  const bar = '='.repeat(112)
  console.log('')
  console.log(bar)
  console.log('THE MATRIX — peak RSS is a number, throughput is a range')
  console.log(bar)
  console.log('scenario'.padEnd(13) + 'store'.padEnd(24) + 'runtime'.padEnd(15) +
    'batches'.padStart(8) + 'peak RSS'.padStart(12) + 'throughput'.padStart(14) + '  throughput min-max')
  console.log('-'.repeat(112))
  for (const [, c] of Object.entries(result.cells)) {
    console.log(
      c.scenario.padEnd(13) + c.storeLabel.padEnd(24) + c.runtimeLabel.padEnd(15) +
      String(c.batches).padStart(8) +
      (mib(c.maxRSSkb.median) + ' MiB').padStart(12) +
      fmt(c.throughput.median).padStart(14) +
      `  ${fmt(c.throughput.min)} .. ${fmt(c.throughput.max)}`)
  }

  const cell = (sc, store, rt) => result.cells[`${sc} | ${STORES[store].label} | ${RUNTIMES[rt].label}`]
  const ratio = (a, b, f) => (a && b) ? (f(a) / f(b)).toFixed(2) + 'x' : '-'
  const rss = (c) => c.maxRSSkb.median
  const tp = (c) => c.throughput.median

  console.log('')
  console.log(bar)
  console.log('STORE ALONE  (Map -> SQLite, runtime held fixed)  — RSS ratio, then throughput ratio')
  console.log('-'.repeat(112))
  for (const sc of SCENARIOS) for (const rt of WANT) {
    const m = cell(sc, 'map', rt), s = cell(sc, 'sqlite', rt)
    if (!m || !s) continue
    console.log(`${sc.padEnd(13)}${RUNTIMES[rt].label.padEnd(15)}` +
      `${(mib(rss(m)) + ' -> ' + mib(rss(s)) + ' MiB').padStart(26)}` +
      `${ratio(m, s, rss).padStart(10)} less memory` +
      `${(fmt(tp(m)) + ' -> ' + fmt(tp(s))).padStart(24)}${ratio(s, m, tp).padStart(10)} throughput`)
  }

  console.log('')
  console.log(bar)
  console.log('RUNTIME ALONE  (Node -> compiled, store held fixed)  — RSS ratio, then throughput ratio')
  console.log('-'.repeat(112))
  for (const sc of SCENARIOS) for (const store of ['map', 'sqlite']) {
    const n = cell(sc, store, 'node25'), e = cell(sc, store, 'exe')
    if (!n || !e) continue
    console.log(`${sc.padEnd(13)}${STORES[store].label.padEnd(24)}` +
      `${(mib(rss(n)) + ' -> ' + mib(rss(e)) + ' MiB').padStart(24)}` +
      `${ratio(n, e, rss).padStart(9)} less memory` +
      `${(fmt(tp(n)) + ' -> ' + fmt(tp(e))).padStart(22)}${ratio(e, n, tp).padStart(9)} throughput`)
  }

  console.log('')
  console.log(bar)
  console.log('CONTROLS')
  for (const [k, c] of Object.entries(result.cells)) {
    if (c.store !== 'sqlite') continue
    console.log(`  ${k.padEnd(58)} ${String(c.rowsInStore).padStart(9)} rows left in table, ` +
      `${c.dbBytes === null ? '?' : (c.dbBytes / 1048576).toFixed(1)} MiB on disk`)
  }
  console.log(`machine before: cpu ${before.cpuLoadPercent}%  node ${before.nodeProcesses}  zig ${before.zigProcesses}  free ${before.freeMemMiB} MiB`)
  console.log(`machine after : cpu ${result.machine.after.cpuLoadPercent}%  node ${result.machine.after.nodeProcesses}  zig ${result.machine.after.zigProcesses}  free ${result.machine.after.freeMemMiB} MiB`)
  console.log(`total wall: ${(result.totalWallSec / 60).toFixed(1)} min`)
  console.log('peak RSS is PeakWorkingSetSize — the TOTAL working set, not Task Manager\'s private-set column.')

  if (JSONOUT) {
    writeFileSync(JSONOUT, JSON.stringify(result, null, 2))
    console.log(`wrote ${JSONOUT}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
