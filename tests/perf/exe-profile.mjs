/**
 * exe-profile.mjs - ATTRIBUTION for the compiled binary.
 *
 * The C-side counterpart of native-backend-profile.cjs, and it keeps that
 * file's most important property: the throughput of a profiled run is NOT
 * comparable with exe-matrix.mjs's. Instrumentation is heavy on purpose.
 * These runs answer "where does it go", never "how fast is it".
 *
 * Two lanes, both EXACT rather than sampled - which is the real difference
 * from the V8 side. A .cpuprofile is samples plus timeDeltas; these are
 * every call and every allocation.
 *
 *   --alloc   malloc/calloc/realloc/free interposed through the
 *             preprocessor, keyed on a compile-time "file:line" literal.
 *             COUNTS AND BYTES per source site - neither of which the
 *             runtime has ever tracked. It counts live OBJECTS by kind,
 *             and under SCRIPTC_RC_SITES=1 names live closures by creation
 *             site, but there is no byte accounting anywhere and no
 *             chokepoint: scr_cyc_alloc covers ~16 object kinds while ~475
 *             raw malloc/calloc/realloc calls sit in ~57 files.
 *
 *   --cpu     -finstrument-functions. Exact per-function call counts.
 *             Verified working under zig cc for x86_64-windows-gnu.
 *
 * Why not the tools the C ecosystem is supposed to have - each measured on
 * this host, not assumed:
 *
 *   --wrap=malloc     "error: unsupported linker arg: --wrap"
 *   linker map        --Map / -Map / /MAP / --cref all rejected;
 *                     --print-map accepted and writes nothing
 *   symbols           the PE has no COFF symbol table (nsyms=0) in any
 *                     variant, and -g leaves no .debug_* section
 *   ASan              no __asan_init on this target, on base too
 *   perf / massif /   Linux only. SCRIPTC_TARGET does cross-compile to
 *   heaptrack         x86_64-linux-gnu and WSL2/Arch is present (but with
 *                     none of the tools installed). Even so: scr_lib.c's
 *                     Windows arm is hand-rolled kernel32
 *                     (K32GetProcessMemoryInfo, GetProcessTimes) where the
 *                     Linux arm is getrusage/clock_gettime, so a Linux
 *                     profile attributes to DIFFERENT functions than the
 *                     shipped Windows binary. Attribution of a binary
 *                     nobody ships is not attribution.
 *
 * That is why the alloc lane keys on source strings and needs no
 * symboliser, and why the cpu lane can only report rvas. The limitation is
 * the toolchain's; it is printed with the results rather than hidden.
 *
 * Run:
 *   node tests/perf/exe-profile.mjs --bench runtime --alloc --out G:/pf/prof
 *   node tests/perf/exe-profile.mjs --bench runtime --cpu   --out G:/pf/prof
 *   node tests/perf/exe-profile.mjs --exe G:/pf/app-pf/x.exe --cwd G:/pf/app-pf --alloc
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH_DIR = path.join(HERE, 'bench')
const PROF_H = path.join(HERE, 'prof', 'scr_prof.h').replace(/\\/g, '/')
const REPO = path.resolve(HERE, '..', '..')
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
const OUT = flag('out', path.join(REPO, 'perf-profile-out'))
const TOP = Number.parseInt(flag('top', '25'), 10)
const LANES = []
if (has('cpu')) LANES.push('cpu')
if (has('alloc')) LANES.push('alloc')
if (LANES.length === 0) LANES.push('alloc')

// A prebuilt binary (zapo's) can be profiled instead of a bench, but only if
// it was BUILT with the matching -D: the instrument is compiled in, never
// attached at run time.
const PREBUILT = flag('exe', null)
const PREBUILT_CWD = flag('cwd', null)

mkdirSync(OUT, { recursive: true })

/** The SCRIPTC_PROF_CFLAGS a lane needs. Exported shape so a zapo build can
 *  use the identical string without this driver having to drive it. */
export function profFlagsFor(lane) {
  return [
    '-include', PROF_H,
    lane === 'cpu' ? '-DSCR_PROF_CPU' : '-DSCR_PROF_ALLOC',
    ...(lane === 'cpu' ? ['-finstrument-functions'] : [])
  ].join(' ')
}

function buildInstrumented(lane) {
  const exe = path.join(OUT, BENCH + '-' + lane + '.exe')
  console.log('  building ' + BENCH + ' [' + lane + '] ...')
  const t = process.hrtime.bigint()
  const res = spawnSync(
    process.execPath,
    [CLI, 'build', BENCH + '.bench.ts', '--backend', 'c', '-o', exe],
    {
      cwd: BENCH_DIR,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      // SCRIPTC_NO_CACHE is NOT optional here. The build cache keys on the
      // runtime fingerprint (every .c/.h under packages/runtime/src) plus
      // the argv -- and scr_prof.h is in NEITHER, because it lives outside
      // that directory and reaches the compile through -include. Editing it
      // therefore does NOT invalidate the cache, and the build silently
      // relinks stale objects compiled against the OLD header. That was
      // measured, not feared: an arming fix looked like it had failed twice
      // in a row until the cache was turned off, at which point the same
      // source passed exactly.
      env: { ...process.env, SCRIPTC_PROF_CFLAGS: profFlagsFor(lane), SCRIPTC_NO_CACHE: '1' }
    }
  )
  const ms = Number(process.hrtime.bigint() - t) / 1e6
  if (res.status !== 0) {
    process.stderr.write(res.stdout ?? '')
    process.stderr.write(res.stderr ?? '')
    throw new Error('instrumented build failed (' + lane + ', exit ' + res.status + ')')
  }
  console.log('    ' + (ms / 1000).toFixed(1) + 's -> ' + exe)
  return exe
}

function runProfiled(exe, lane, cwd) {
  const profOut = path.join(OUT, BENCH + '-' + lane + '.prof.txt')
  const t = process.hrtime.bigint()
  const res = spawnSync(exe, [], {
    cwd: cwd ?? BENCH_DIR,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...process.env,
      BENCH_LANE: 'exe-' + lane,
      SCR_PROF_OUT: profOut,
      // Instrumented runs are slow by construction; the workload is kept
      // small because these numbers are attribution and never throughput.
      BENCH_MIN_MS: flag('min-ms', '400'),
      BENCH_N: flag('n', '20000')
    }
  })
  const wallMs = Number(process.hrtime.bigint() - t) / 1e6
  if (res.status !== 0) {
    process.stderr.write((res.stdout ?? '').slice(0, 4000))
    process.stderr.write((res.stderr ?? '').slice(0, 4000))
    throw new Error('profiled run failed (' + lane + ', exit ' + res.status + ')')
  }
  if (!existsSync(profOut)) throw new Error('no profile written to ' + profOut)
  return { profOut, wallMs, stdout: res.stdout ?? '' }
}

function parseProf(file) {
  const rows = []
  let kind = null
  let total = null
  for (const line of readFileSync(file, 'utf8').split(NL)) {
    const s = line.replace(/\r$/, '')
    if (s.startsWith('PROF-KIND ')) {
      kind = s.slice(10).trim()
    } else if (s.startsWith('PROF-TOTAL ')) {
      total = Object.fromEntries(
        s.slice(11).trim().split(/\s+/).map((kv) => {
          const p = kv.split('=')
          return [p[0], Number(p[1])]
        })
      )
    } else if (s.startsWith('PROF ')) {
      // count bytes freed rva name   (name is last; it may contain spaces)
      const m = /^PROF (\d+) (\d+) (\d+) ([0-9a-f]+) (.*)$/.exec(s)
      if (!m) continue
      rows.push({
        count: Number(m[1]),
        bytes: Number(m[2]),
        freed: Number(m[3]),
        rva: m[4],
        name: m[5] === '?' ? null : m[5]
      })
    }
  }
  return { kind, rows, total }
}

const fmt = (n) => Number(n).toLocaleString('en-US')

function main() {
  const report = {
    schema: 'scriptc-perf-profile/1',
    bench: PREBUILT ?? BENCH,
    at: new Date().toISOString(),
    lanes: {}
  }
  console.log('compiled-binary attribution - EXACT counts, not samples')
  console.log('NOTE: instrumented throughput is NOT comparable with exe-matrix.mjs. Attribution only.')
  console.log('')

  for (const lane of LANES) {
    console.log('### lane=' + lane)
    const exe = PREBUILT ?? buildInstrumented(lane)
    if (PREBUILT) console.log('  using prebuilt ' + exe + ' (must have been built with the matching -D)')
    const run = runProfiled(exe, lane, PREBUILT_CWD)
    console.log('  run wall ' + (run.wallMs / 1000).toFixed(2) + 's -> ' + run.profOut)

    const prof = parseProf(run.profOut)
    if (prof.total && prof.total.lost) {
      console.log('  WARNING: ' + prof.total.lost + ' site(s) LOST to a full table - every count below is a FLOOR')
    }

    // Group by name. The alloc lane names every row "file:line"; the cpu
    // lane has no names available on this toolchain, so its rows stay rvas
    // and are LABELLED unattributed rather than quietly aggregated.
    const bySym = new Map()
    for (const r of prof.rows) {
      const key = r.name ?? ('<rva:' + r.rva + '>')
      const a = bySym.get(key) ?? { symbol: key, count: 0, bytes: 0, freed: 0, rows: 0 }
      a.count += r.count
      a.bytes += r.bytes
      a.freed += r.freed
      a.rows += 1
      bySym.set(key, a)
    }
    const agg = [...bySym.values()].sort((a, b) => (lane === 'alloc' ? b.bytes - a.bytes : b.count - a.count))

    console.log('')
    if (lane === 'alloc') {
      const tb = (prof.total && prof.total.bytes) || 0
      const tc = (prof.total && prof.total.count) || 0
      const tf = (prof.total && prof.total.freed) || 0
      console.log('  ALLOCATION by SOURCE SITE')
      console.log('  ' + fmt(tc) + ' allocations, ' + fmt(tb) + ' bytes, ' + fmt(tf) +
        ' frees, ' + fmt(agg.length) + ' distinct sites')
      console.log('  Covers every malloc/calloc/realloc written in scriptc sources. Allocations')
      console.log('  inside libc or a vendored archive are NOT included: this is not the whole process.')
      console.log('  ' + 'bytes'.padStart(15) + 'MiB'.padStart(9) + '%'.padStart(7) +
        'allocs'.padStart(13) + 'frees'.padStart(12) + '  site')
      let cum = 0
      for (const a of agg.slice(0, TOP)) {
        cum += a.bytes
        console.log('  ' + fmt(a.bytes).padStart(15) +
          (a.bytes / 1048576).toFixed(1).padStart(9) +
          (tb ? ((a.bytes / tb) * 100).toFixed(1) : '0').padStart(7) +
          fmt(a.count).padStart(13) + fmt(a.freed).padStart(12) + '  ' + a.symbol)
      }
      if (tb) console.log('  top ' + Math.min(TOP, agg.length) + ' sites = ' + ((cum / tb) * 100).toFixed(1) + '% of bytes')

      const byCount = [...agg].sort((a, b) => b.count - a.count)
      console.log('')
      console.log('  ' + 'allocs'.padStart(15) + '%'.padStart(8) + '  site   (ranked by COUNT, not bytes)')
      let cc = 0
      for (const a of byCount.slice(0, TOP)) {
        cc += a.count
        console.log('  ' + fmt(a.count).padStart(15) +
          (tc ? ((a.count / tc) * 100).toFixed(1) : '0').padStart(8) + '  ' + a.symbol)
      }
      if (tc) console.log('  top ' + Math.min(TOP, byCount.length) + ' sites = ' + ((cc / tc) * 100).toFixed(1) + '% of allocations')
    } else {
      const tc = (prof.total && prof.total.count) || 0
      console.log('  CALLS by function - ' + fmt(tc) + ' calls across ' + fmt(agg.length) + ' distinct functions')
      console.log('  EXACT counts (every call), not samples. Function NAMES are unavailable on')
      console.log('  this toolchain - see scr_prof.h for the routes tried - so rows are rvas.')
      console.log('  ' + 'calls'.padStart(15) + '%'.padStart(8) + '  function rva')
      for (const a of agg.slice(0, TOP)) {
        console.log('  ' + fmt(a.count).padStart(15) +
          (tc ? ((a.count / tc) * 100).toFixed(1) : '0').padStart(8) + '  ' + a.symbol)
      }
    }
    console.log('')
    report.lanes[lane] = {
      exe,
      wallMs: run.wallMs,
      kind: prof.kind,
      total: prof.total,
      sites: agg.slice(0, 500)
    }
  }

  const j = path.join(OUT, path.basename(String(report.bench)).replace(/[^\w.-]/g, '_') + '-profile.json')
  writeFileSync(j, JSON.stringify(report, null, 2))
  console.log('wrote ' + j)
}

main()
