/**
 * xlane-calls.mjs - does the LINUX profile attribute to the same functions
 * doing the same work as the SHIPPED WINDOWS binary? Checked, not argued.
 *
 * The two attribution lanes already produce a per-function CALL COUNT each,
 * and neither is a sample:
 *
 *   Windows  exe-profile.mjs --cpu, -finstrument-functions, symbolised from
 *            the PDB. Every call to every instrumented function.
 *   Linux    ab-callgrind.mjs, valgrind's `calls=` records on a
 *            x86_64-linux-gnu cross build. Every call to every function.
 *
 * Run the SAME scenario with the SAME fixed work in both and the counts are
 * directly comparable. Where they agree, the Linux lane is looking at the
 * same code doing the same thing, and its cost numbers transfer as a
 * hypothesis. Where they disagree, this prints why - and the two reasons it
 * finds are not the same reason:
 *
 *   WIN-ONLY   -finstrument-functions FORCES a function to survive as a real
 *              call on the Windows arm; the Linux build, uninstrumented,
 *              inlined it. That is an INSTRUMENT difference, not a platform
 *              one, and it makes the Windows list longer, not the Linux list
 *              wrong.
 *   LINUX-ONLY a libc/libm frame the Windows instrument cannot see at all
 *              (nothing outside our TUs is instrumented). glibc's fmod is
 *              the loud one.
 *
 * A count that differs by a HANDFUL on a function called 400,000 times is
 * startup and teardown, which genuinely differ (argv, environment, locale);
 * the report separates exact matches from near matches so that is visible
 * rather than rounded away.
 *
 * Run:
 *   node tests/perf/exe-profile.mjs --bench runtime --cpu --out <dir>     # win
 *   node tests/perf/ab-callgrind.mjs --bench runtime --out <dir2>          # linux
 *   node tests/perf/xlane-calls.mjs --win <dir>/runtime-profile.json \
 *        --linux <dir2>/runtime-callgrind.json --scenario numeric-modulo
 *
 * BENCH_ONLY and BENCH_MAX_BATCHES=1 must be set for the Windows run, or the
 * two lanes are not running the same work and the comparison is meaningless.
 * This refuses rather than guesses: --scenario is required and the Windows
 * profile must carry the matching scenario tag.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  if (i < 0) return d
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? '1' : v
}

const WIN = flag('win', null)
const LIN = flag('linux', null)
const SCENARIO = flag('scenario', null)
const TOP = Number.parseInt(flag('top', '40'), 10)
const NL = String.fromCharCode(10)

if (WIN === null || LIN === null || SCENARIO === null) {
  console.error('usage: --win <exe-profile json> --linux <ab-callgrind json> --scenario <name>')
  process.exit(2)
}

const win = JSON.parse(readFileSync(WIN, 'utf8'))
const lin = JSON.parse(readFileSync(LIN, 'utf8'))

const cpuLane = win.lanes && win.lanes.cpu
if (!cpuLane) { console.error(WIN + ' has no --cpu lane; rerun exe-profile.mjs with --cpu'); process.exit(2) }
const sc = (lin.scenarios ?? []).find((s) => s.scenario === SCENARIO)
if (!sc) {
  console.error('no scenario "' + SCENARIO + '" in ' + LIN + '; it has: ' + (lin.scenarios ?? []).map((s) => s.scenario).join(', '))
  process.exit(2)
}

// HEALTH: an empty lane reads as "everything matches", the same trap as a
// cycles column of zeros. Refuse instead.
if (!Array.isArray(cpuLane.sites) || cpuLane.sites.length === 0) { console.error('the Windows cpu lane has no rows - DID-NOT-RUN'); process.exit(3) }
if (!Array.isArray(sc.rows) || sc.rows.length === 0) { console.error('the Linux scenario has no rows - DID-NOT-RUN'); process.exit(3) }
if (!sc.ran) { console.error('the Linux scenario has no SCBENCH line - DID-NOT-RUN'); process.exit(3) }

const w = new Map()
for (const s of cpuLane.sites) if (s.symbol) w.set(s.symbol, (w.get(s.symbol) ?? 0) + s.count)
const l = new Map()
for (const r of sc.rows) {
  if (/\s\[[^\]]+\]$/.test(r.name)) continue // shared library: invisible to the Windows instrument by construction
  // callgrind names a recursive instance `fn'2`; it is the same function, and
  // the Windows instrument counts every entry under the one name
  const bare = r.name.replace(/'\d+$/, '')
  if (r.calls > 0) l.set(bare, (l.get(bare) ?? 0) + r.calls)
}
const foreign = sc.rows.filter((r) => /\s\[[^\]]+\]$/.test(r.name) && r.calls > 0)

const names = [...new Set([...w.keys(), ...l.keys()])]
const rows = names.map((n) => {
  const a = w.get(n) ?? 0
  const b = l.get(n) ?? 0
  let verdict
  if (a > 0 && b > 0) verdict = a === b ? 'EXACT' : 'NEAR'
  else if (a > 0) verdict = 'WIN-ONLY'
  else verdict = 'LINUX-ONLY'
  return { name: n, win: a, linux: b, delta: b - a, verdict }
}).sort((x, y) => Math.max(y.win, y.linux) - Math.max(x.win, x.linux))

const tally = { EXACT: 0, NEAR: 0, 'WIN-ONLY': 0, 'LINUX-ONLY': 0 }
const callsIn = { EXACT: 0, NEAR: 0, 'WIN-ONLY': 0, 'LINUX-ONLY': 0 }
for (const r of rows) { tally[r.verdict] += 1; callsIn[r.verdict] += Math.max(r.win, r.linux) }

const fmt = (n) => Number(n).toLocaleString('en-US')
const pad = (s, k) => String(s).padEnd(k)
const rpad = (s, k) => String(s).padStart(k)

console.log('cross-lane call counts   scenario=' + SCENARIO)
console.log('  windows: ' + path.basename(WIN) + '   ' + fmt(cpuLane.total?.count ?? 0) + ' calls across ' + w.size + ' functions' +
  '   symbols named ' + (cpuLane.symbols?.named ?? 0) + '/' + (cpuLane.symbols?.rows ?? 0))
console.log('  linux:   ' + path.basename(LIN) + '   ' + fmt([...l.values()].reduce((a, b) => a + b, 0)) +
  ' calls across ' + l.size + ' functions (our binary only)   total Ir ' + fmt(sc.total))
console.log('')
console.log('  ' + pad('function', 34) + rpad('windows calls', 16) + rpad('linux calls', 15) + rpad('delta', 12) + '  verdict')
for (const r of rows.slice(0, TOP)) {
  console.log('  ' + pad(r.name.slice(0, 33), 34) + rpad(r.win === 0 ? '-' : fmt(r.win), 16) +
    rpad(r.linux === 0 ? '-' : fmt(r.linux), 15) +
    rpad(r.win > 0 && r.linux > 0 ? (r.delta >= 0 ? '+' : '') + fmt(r.delta) : '-', 12) + '  ' + r.verdict)
}
if (rows.length > TOP) console.log('  (' + (rows.length - TOP) + ' more)')
console.log('')
console.log('  EXACT      ' + rpad(tally.EXACT, 4) + ' functions, identical call count in both lanes')
console.log('  NEAR       ' + rpad(tally.NEAR, 4) + ' functions, same function, counts differ (startup/teardown differ by design)')
console.log('  WIN-ONLY   ' + rpad(tally['WIN-ONLY'], 4) + ' functions, present only on Windows - -finstrument-functions blocks the inline the Linux build performed')
console.log('  LINUX-ONLY ' + rpad(tally['LINUX-ONLY'], 4) + ' functions, present only on Linux')
if (foreign.length > 0) {
  console.log('')
  console.log('  shared-library frames the Windows instrument cannot see at all (' + foreign.length + '):')
  for (const f of foreign.sort((a, b) => b.self - a.self).slice(0, 6)) {
    console.log('    ' + pad(f.name.slice(0, 40), 42) + rpad(fmt(f.calls), 12) + ' calls   ' + rpad(fmt(f.self), 14) + ' self Ir')
  }
}

const jsonOut = flag('json', null)
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ scenario: SCENARIO, win: WIN, linux: LIN, tally, callsIn, rows, foreign }, null, 2))
  console.log(NL + 'json -> ' + jsonOut)
}
