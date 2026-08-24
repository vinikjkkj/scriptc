/**
 * platform-divergence.mjs - HOW MUCH of the compiled program is the same C
 * on Windows and on Linux, measured rather than assumed.
 *
 * exe-profile.mjs's header rules a Linux profile out with one sentence:
 *
 *   "scr_lib.c's Windows arm is hand-rolled kernel32 (K32GetProcessMemoryInfo,
 *    GetProcessTimes) where the Linux arm is getrusage/clock_gettime, so a
 *    Linux profile attributes to DIFFERENT functions than the shipped Windows
 *    binary. Attribution of a binary nobody ships is not attribution."
 *
 * The premise is true of scr_lib.c. The conclusion is a claim about the WHOLE
 * binary, and nobody had measured it. This does.
 *
 * METHOD - exact, not estimated. For every C source a build compiles, run the
 * PREPROCESSOR for both targets with the build's own -std/-I/-D. Keep only the
 * text whose `# <line> "<file>"` origin marker points inside the repo: mingw
 * and glibc system headers differ totally and are not the question - the
 * question is about OUR functions. Cut the kept text into top-level function
 * definitions by brace matching and compare each function's body between the
 * two targets.
 *
 * THREE TIERS, because a naive byte compare answers the wrong question. Both
 * of the first two examples below were found by running it:
 *
 *   T0 raw          bodies byte-identical after whitespace collapse.
 *                   `decimalLength9` (vendor/ryu) fails T0 for one reason
 *                   only: mingw's assert() expands to `_assert(...)` and
 *                   glibc's to `__assert_fail(...)`. Same algorithm.
 *
 *   T1 same-value   plus integer literals canonicalised. `scr_str_retain`
 *                   fails T0 because SIZE_MAX is spelled
 *                   `0xffffffffffffffffULL` by mingw and
 *                   `(18446744073709551615UL)` by glibc. Same constant, same
 *                   instructions.
 *
 *   T2 algorithmic  T1 with the sources preprocessed -DNDEBUG, so the
 *                   assert MACHINERY is gone from both arms and what is left
 *                   is the code the function exists to run. This is the
 *                   number to quote for "does a Linux profile attribute to
 *                   the same code". (The shipped build does NOT define
 *                   NDEBUG for the runtime - only for the vendored engine -
 *                   so T0/T1 are the as-shipped text and T2 is the
 *                   algorithm. Both are reported; neither is hidden.)
 *
 * Every function lands in one bucket per tier: SAME / DIVERGENT / WIN-ONLY /
 * LINUX-ONLY. Weights: function COUNT (does a name in a Linux profile mean
 * the same thing?) and post-preprocessing LINE count (how much of the program
 * is it?). Neither is a time weight - weighting by measured cost is
 * ab-callgrind.mjs's job and the two are meant to be read together.
 *
 * SELF-CHECK: a target compared against ITSELF must report 0 divergent, 0
 * platform-only, every function SAME. `--selftest` runs exactly that and
 * exits non-zero if the instrument cannot say "no difference".
 *
 * Run:
 *   node tests/perf/platform-divergence.mjs --selftest
 *   node tests/perf/platform-divergence.mjs --tu <path>/messaging.bench.c --json out.json
 *   node tests/perf/platform-divergence.mjs --only scr_object.c --show scr_str_retain
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const RT_DIR = path.join(REPO, 'packages', 'runtime', 'src')
const NL = String.fromCharCode(10)

const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  if (i < 0) return d
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? '1' : v
}
const has = (n) => argv.includes('--' + n)

const SHOW = flag('show', null)
/** --per-tu: report every TU whose two targets parsed different function
 *  counts out of the same origin file. That is how the aggregation bug above
 *  was found, so the diagnostic ships with the fix. */
const PER_TU = has('per-tu')
const WIN = 'x86_64-windows-gnu'
const LIN = 'x86_64-linux-gnu'
const TIERS = ['T0-raw', 'T1-same-value', 'T2-algorithmic']

/* ── the preprocessor ───────────────────────────────────────────────────── */

/** zig cc -E for one source, one target, one define set. A source that does
 *  not preprocess at all for a target is reported, never silently dropped. */
function preprocess(src, target, extraArgs, ndebug) {
  // -E only, never -P: the linemarkers are LOAD-BEARING here - they are how
  // our own source is told apart from the sysroot.
  const args = [
    'cc', '-target', target, '-std=c11', '-E',
    ...(ndebug ? ['-DNDEBUG'] : []),
    '-I', RT_DIR,
    ...extraArgs,
    src
  ]
  const res = spawnSync('zig', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  if (res.error) throw new Error('zig cc not runnable: ' + res.error.message)
  if (res.status !== 0) return { ok: false, err: (res.stderr ?? '').slice(0, 600) }
  return { ok: true, text: res.stdout ?? '' }
}

/* ── keep only the text that came from OUR files ────────────────────────── */

/** Split preprocessed output into runs tagged with their origin file. */
function originRuns(text) {
  const runs = []
  let file = '<none>'
  let buf = []
  const flush = () => {
    if (buf.length > 0) runs.push({ file, text: buf.join(NL) })
    buf = []
  }
  for (const raw of text.split(NL)) {
    const s = raw.replace(/\r$/, '')
    const m = /^# (\d+) "(.*?)"/.exec(s)
    if (m) { flush(); file = m[2].replace(/\\\\/g, '/').replace(/\\/g, '/'); continue }
    buf.push(s)
  }
  flush()
  return runs
}

const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase()

/** Ours, as opposed to a sysroot header. Vendored third-party C reached
 *  through packages/runtime/src counts: it is in the shipped binary and it is
 *  compiled from the same tree for both targets. */
function isProjectFile(file, tuPath) {
  const f = norm(file)
  if (tuPath && String(tuPath).split(',').some((t) => norm(t.trim()) === f)) return true
  if (f.includes('/packages/runtime/')) return true
  return false
}

/* ── cut into top-level function definitions ────────────────────────────── */

/** Brace-match into top-level `{...}` constructs, keeping the function
 *  DEFINITIONS (a struct/union/enum/initialiser is followed by `;` or `,`). */
function functions(src) {
  const out = []
  let i = 0
  let depth = 0
  let headStart = 0
  let bodyStart = -1
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf(NL, i); i = e < 0 ? n : e + 1; continue }
    if (c === '"' || c === "'") {
      const q = c
      i += 1
      while (i < n && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1 }
      i += 1
      continue
    }
    if (c === '{') {
      if (depth === 0) bodyStart = i
      depth += 1
      i += 1
      continue
    }
    if (c === '}') {
      depth -= 1
      if (depth === 0) {
        let j = i + 1
        while (j < n && /\s/.test(src[j])) j += 1
        const isDefn = src[j] !== ';' && src[j] !== ','
        if (isDefn && bodyStart >= 0) {
          const name = functionName(src.slice(headStart, bodyStart))
          if (name !== null) {
            const body = src.slice(bodyStart, i + 1)
            out.push({ name, body, lines: body.split(NL).length })
          }
        }
        headStart = src[j] === ';' ? j + 1 : i + 1
        bodyStart = -1
      }
      if (depth < 0) depth = 0
      i += 1
      continue
    }
    if (c === ';' && depth === 0) { headStart = i + 1; bodyStart = -1; i += 1; continue }
    i += 1
  }
  return out
}

/** The identifier immediately before the LAST top-level paren group of a head.
 *  null when the head is not a function (a struct tag, an initialiser). */
function functionName(headRaw) {
  let head = headRaw.replace(/\n/g, ' ')
  head = head.replace(/__attribute__\s*\(\(.*\)\)\s*$/, '').replace(/\s+$/, '')
  if (head.length === 0 || head[head.length - 1] !== ')') return null
  let depth = 0
  let i = head.length - 1
  for (; i >= 0; i -= 1) {
    if (head[i] === ')') depth += 1
    else if (head[i] === '(') { depth -= 1; if (depth === 0) break }
  }
  if (i < 0) return null
  const m = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(head.slice(0, i).replace(/\s+$/, ''))
  if (m === null) return null
  const name = m[1]
  if (['if', 'for', 'while', 'switch', 'return', 'sizeof', '_Alignof', 'typedef', 'struct', 'union', 'enum', 'do', 'else'].includes(name)) return null
  return name
}

/* ── body normalisation, one function per tier ──────────────────────────── */

/** T0: whitespace only. A reformat is not a divergence; anything else is. */
const t0 = (b) => b.replace(/\s+/g, ' ').trim()

/** C tokens, coarsely: strings, char literals, identifiers, numbers, and any
 *  other single non-space character. Both whitespace AND its placement stop
 *  mattering, which T1 needs: with NDEBUG, mingw's assert() is `((void)0)`
 *  and glibc's is `((void) (0))`, the same nothing spelled two ways. */
const TOKEN = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*|0[xX][0-9a-fA-F]+[uUlL]*|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?[uUlLfF]*|\.\d+(?:[eE][+-]?\d+)?[fFlL]*|\S)/g

/** T1: the same TOKENS, integer literals reduced to their VALUE, redundant
 *  parens around a literal dropped. mingw spells SIZE_MAX
 *  `0xffffffffffffffffULL` and glibc `(18446744073709551615UL)`; the emitted
 *  instruction is the same either way, and calling that a divergence inflated
 *  the headline by a third when it was first measured. */
function t1(b) {
  const toks = String(b).match(TOKEN) ?? []
  const out = toks.map((t) => {
    let m = /^0[xX]([0-9a-fA-F]+)[uUlL]*$/.exec(t)
    if (m) return BigInt('0x' + m[1]).toString(10)
    m = /^(\d+)[uUlL]+$/.exec(t)
    if (m) return m[1]
    return t
  })
  // strip parens wrapping a bare literal, repeatedly: `( ( 0 ) )` -> `0`
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false
    for (let i = out.length - 1; i >= 2; i -= 1) {
      if (out[i] === ')' && out[i - 2] === '(' && /^\d/.test(out[i - 1])) {
        out.splice(i, 1)
        out.splice(i - 2, 1)
        changed = true
      }
    }
    if (!changed) break
  }
  return out.join(' ')
}

/* ── one source, both targets, both define sets ─────────────────────────── */

function parseOne(pp, tuPath) {
  const byOrigin = new Map()
  for (const r of originRuns(pp.text)) {
    if (!isProjectFile(r.file, tuPath)) continue
    const key = path.basename(r.file)
    if (!byOrigin.has(key)) byOrigin.set(key, [])
    byOrigin.get(key).push(r.text)
  }
  const fns = new Map()
  for (const [origin, chunks] of byOrigin) {
    for (const f of functions(chunks.join(NL))) {
      const key = origin + '::' + f.name
      if (fns.has(key)) continue // a static helper cannot collide inside one TU
      fns.set(key, { ...f, origin })
    }
  }
  return fns
}

function bucketOf(fa, fb, normalise) {
  if (fa && fb) return normalise(fa.body) === normalise(fb.body) ? 'same' : 'divergent'
  return fa ? 'win-only' : 'linux-only'
}

/* ── driver ─────────────────────────────────────────────────────────────── */

function tally(rows, tier) {
  const fns = { same: 0, divergent: 0, 'win-only': 0, 'linux-only': 0 }
  const lines = { same: 0, divergent: 0, 'win-only': 0, 'linux-only': 0 }
  for (const r of rows) {
    const b = r.tiers[tier]
    fns[b] += 1
    lines[b] += r.lines
  }
  return { fns, lines }
}

/* ── cost weighting ─────────────────────────────────────────────────────── */

/**
 * COST-WEIGHTED DIVERGENCE, which is the number that actually decides whether
 * a Linux profile is worth reading.
 *
 * Counting functions weights `scr_child.c`'s 102 spawn helpers the same as
 * `scr_map.c`'s hash probe, and a messaging run calls the first zero times.
 * The decisive question is not how many functions diverge but how much of the
 * MEASURED COST lands on functions that are the same C - so this joins the
 * per-function verdicts to ab-callgrind.mjs's per-function Ir and reports the
 * split per scenario.
 *
 *   --weight <ab-callgrind json>   --div <a previous --json output>
 *
 * The join is by function NAME, because that is all callgrind reports. Names
 * that appear in more than one origin file are counted once and listed, and
 * cost that lands on a frame this tool never saw (libc, ld.so, an
 * unsymbolised address) is reported as UNATTRIBUTED rather than folded into
 * either side.
 */
function weightMain() {
  const divPath = flag('div', null)
  const weightPath = flag('weight', null)
  if (divPath === null) { console.error('--weight needs --div <platform-divergence json>'); process.exit(2) }
  const div = JSON.parse(readFileSync(divPath, 'utf8'))
  const cg = JSON.parse(readFileSync(weightPath, 'utf8'))
  const TIER = flag('tier', 'T2-algorithmic')

  const byName = new Map()
  const collisions = new Set()
  for (const f of div.functions) {
    const prev = byName.get(f.name)
    if (prev === undefined) byName.set(f.name, f)
    else if (prev.tiers[TIER] !== f.tiers[TIER]) collisions.add(f.name)
  }

  const pad = (s, w) => String(s).padEnd(w)
  const rpad = (s, w) => String(s).padStart(w)
  const fmt = (n) => Number(n).toLocaleString('en-US')
  console.log('cost-weighted divergence   tier=' + TIER + '   cost=self Ir from ' + path.basename(weightPath))
  console.log('bench=' + cg.bench + '   triple=' + cg.triple)
  if (collisions.size > 0) console.log('name collisions across origin files (verdict differs): ' + [...collisions].join(', '))
  console.log('')
  console.log(pad('scenario', 24) + rpad('total Ir', 15) + rpad('same%', 9) + rpad('diverg%', 9) +
    rpad('winOnly%', 10) + rpad('linOnly%', 10) + rpad('system%', 9) + rpad('unattrib%', 11))
  const out = []
  for (const sc of cg.scenarios) {
    /* SYSTEM is its own bucket and not folded into either side. A frame in
     * libc/libm/ld is by construction a DIFFERENT implementation on Windows -
     * glibc's fmod is not msvcrt's - so counting it as "same" would be a lie;
     * but it is also not scriptc's code, so counting it as divergence would
     * blame the compiler for a libm call it merely emitted. numeric-modulo
     * spends 36.8% of its instructions in glibc's fmod, and that fact belongs
     * in its own column. */
    const acc = { same: 0, divergent: 0, 'win-only': 0, 'linux-only': 0, system: 0, unattributed: 0 }
    const unattributedTop = []
    const systemTop = []
    for (const r of sc.rows) {
      const foreign = /\s\[[^\]]+\]$/.test(r.name)
      if (foreign) { acc.system += r.self; systemTop.push(r); continue }
      // callgrind names a recursive instance `fn'2`; it is the same function
      const hit = byName.get(r.name.replace(/'\d+$/, ''))
      if (hit === undefined) { acc.unattributed += r.self; unattributedTop.push(r); continue }
      acc[hit.tiers[TIER]] += r.self
    }
    const t = sc.total || Object.values(acc).reduce((a, b) => a + b, 0)
    const p = (x) => (100 * x / t).toFixed(2)
    console.log(pad(sc.scenario, 24) + rpad(fmt(t), 15) + rpad(p(acc.same), 9) + rpad(p(acc.divergent), 9) +
      rpad(p(acc['win-only']), 10) + rpad(p(acc['linux-only']), 10) + rpad(p(acc.system), 9) + rpad(p(acc.unattributed), 11))
    unattributedTop.sort((a, b) => b.self - a.self)
    systemTop.sort((a, b) => b.self - a.self)
    out.push({ scenario: sc.scenario, total: t, ...acc,
      systemTop: systemTop.slice(0, 6).map((r) => ({ name: r.name, self: r.self })),
      unattributedTop: unattributedTop.slice(0, 8).map((r) => ({ name: r.name, self: r.self })) })
  }
  console.log('')
  console.log('largest SYSTEM frames per scenario (a different C library on each platform):')
  for (const o of out) {
    console.log('  ' + pad(o.scenario, 22) + o.systemTop.map((r) => r.name.slice(0, 34) + ' ' + fmt(r.self)).join(' | '))
  }
  const anyUnattr = out.filter((o) => o.unattributed > 0)
  if (anyUnattr.length > 0) {
    console.log('')
    console.log('UNATTRIBUTED frames (a name this tool never parsed - pass its TU with --tu):')
    for (const o of anyUnattr) {
      console.log('  ' + pad(o.scenario, 22) + o.unattributedTop.map((r) => r.name.slice(0, 34) + ' ' + fmt(r.self)).join(' | '))
    }
  }
  const jsonOut = flag('json', null)
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ tier: TIER, bench: cg.bench, scenarios: out }, null, 2)); console.log(NL + 'json -> ' + jsonOut) }
}

function main() {
  if (flag('weight', null) !== null) return weightMain()
  const selftest = has('selftest')
  const tuPath = flag('tu', null)
  const only = flag('only', null)
  const extraArgs = (flag('cflags', '') || '').split(/\s+/).filter(Boolean)

  const sources = []
  for (const n of readdirSync(RT_DIR).sort()) {
    if (!n.endsWith('.c')) continue
    if (only && !n.includes(only)) continue
    sources.push(path.join(RT_DIR, n))
  }
  // --tu takes a comma-separated list: one emitted TU per bench, and the
  // cost weighting needs every TU whose functions appear in the profile.
  const tuList = tuPath === null ? [] : String(tuPath).split(',').map((x) => x.trim()).filter(Boolean)
  for (const t of tuList) {
    if (!existsSync(t)) { console.error('no such TU: ' + t); process.exit(2) }
    sources.push(t)
  }

  const B = selftest ? WIN : LIN
  console.log('platform-divergence  A=' + WIN + '  B=' + B + (selftest ? '   (SELFTEST: same target twice)' : ''))
  console.log('sources: ' + sources.length + (tuList.length ? '  (runtime + ' + tuList.map((t) => path.basename(t)).join(' + ') + ')' : '  (runtime)'))
  console.log('')

  const uniq = new Map()
  const failed = []
  for (const src of sources) {
    const base = path.basename(src)
    const ppWin = preprocess(src, WIN, extraArgs, false)
    const ppLin = preprocess(src, B, extraArgs, false)
    if (!ppWin.ok && !ppLin.ok) { failed.push({ file: base, why: 'neither target preprocesses' }); process.stdout.write('x'); continue }
    if (!ppWin.ok || !ppLin.ok) { failed.push({ file: base, why: (ppWin.ok ? B : WIN) + ' only' }); process.stdout.write('!'); continue }
    const ppWinN = preprocess(src, WIN, extraArgs, true)
    const ppLinN = preprocess(src, B, extraArgs, true)

    const A0 = parseOne(ppWin, tuPath)
    const B0 = parseOne(ppLin, tuPath)
    const AN = ppWinN.ok ? parseOne(ppWinN, tuPath) : A0
    const BN = ppLinN.ok ? parseOne(ppLinN, tuPath) : B0

    /* A function reached from 40 TUs is ONE function, and the 40 sightings do
     * not always agree: a helper in scr_runtime.h can be parsed out of one TU
     * and not another (a #define in the includer, a conditional include).
     * Absence in ONE sighting is not evidence of platform-only-ness, so
     * presence is accumulated as an OR across sightings and only divergence is
     * accumulated as "divergent anywhere". Taking the worst of every field
     * instead was measured: it moved 27 of scr_runtime.h's 29 functions into
     * WIN-ONLY on the strength of a single TU that parsed none of them. */
    for (const key of new Set([...A0.keys(), ...B0.keys()])) {
      const fa = A0.get(key)
      const fb = B0.get(key)
      const f = fa ?? fb
      const na = AN.get(key)
      const nb = BN.get(key)
      let acc = uniq.get(key)
      if (acc === undefined) {
        acc = { key, origin: f.origin, name: f.name, lines: 0, seenA: false, seenB: false, sightings: 0, div: { 'T0-raw': false, 'T1-same-value': false, 'T2-algorithmic': false } }
        uniq.set(key, acc)
      }
      acc.sightings += 1
      acc.seenA = acc.seenA || fa !== undefined
      acc.seenB = acc.seenB || fb !== undefined
      acc.lines = Math.max(acc.lines, fa ? fa.lines : 0, fb ? fb.lines : 0)
      if (fa && fb) {
        if (t0(fa.body) !== t0(fb.body)) acc.div['T0-raw'] = true
        if (t1(fa.body) !== t1(fb.body)) acc.div['T1-same-value'] = true
        // NDEBUG can delete a `static` helper whose only use was an assert;
        // when it is gone from both arms, fall back to the T1 verdict.
        if (na && nb) { if (t1(na.body) !== t1(nb.body)) acc.div['T2-algorithmic'] = true }
        else if (t1(fa.body) !== t1(fb.body)) acc.div['T2-algorithmic'] = true
      }
      if (SHOW !== null && f.name === SHOW && acc.bodyA === undefined) {
        acc.bodyA = fa ? fa.body : null
        acc.bodyB = fb ? fb.body : null
        acc.bodyAN = na ? na.body : null
        acc.bodyBN = nb ? nb.body : null
      }
    }
    if (PER_TU) {
      const cnt = (m, o) => [...m.values()].filter((x) => x.origin === o).length
      const origins = new Set([...A0.values(), ...B0.values()].map((x) => x.origin))
      for (const o of [...origins].sort()) {
        const a = cnt(A0, o)
        const b = cnt(B0, o)
        if (a !== b) console.log(NL + '  [per-tu] ' + base + ' -> ' + o + ': win ' + a + ' fns, linux ' + b + ' fns')
      }
    }
    process.stdout.write('.')
  }
  process.stdout.write(NL + NL)

  for (const r of uniq.values()) {
    r.tiers = {}
    for (const tier of TIERS) {
      r.tiers[tier] = !r.seenA ? 'linux-only' : !r.seenB ? 'win-only' : r.div[tier] ? 'divergent' : 'same'
    }
  }
  const all = [...uniq.values()].sort((x, y) => (x.origin + x.name).localeCompare(y.origin + y.name))
  const total = all.length
  const pct = (x, d) => d === 0 ? '0.00' : (100 * x / d).toFixed(2)
  const pad = (s, w) => String(s).padEnd(w)
  const rpad = (s, w) => String(s).padStart(w)

  const byOrigin = new Map()
  for (const r of all) {
    if (!byOrigin.has(r.origin)) byOrigin.set(r.origin, [])
    byOrigin.get(r.origin).push(r)
  }
  const originRows = [...byOrigin.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const HEAD = 'T2-algorithmic'
  console.log('per origin file, tier ' + HEAD + ':')
  console.log(pad('origin file', 26) + rpad('fns', 6) + rpad('same', 7) + rpad('diverg', 8) + rpad('winOnly', 9) + rpad('linOnly', 9) + rpad('same%', 8))
  for (const [origin, rs] of originRows) {
    const t = tally(rs, HEAD)
    console.log(
      pad(origin, 26) + rpad(rs.length, 6) + rpad(t.fns.same, 7) + rpad(t.fns.divergent, 8) +
      rpad(t.fns['win-only'], 9) + rpad(t.fns['linux-only'], 9) + rpad(pct(t.fns.same, rs.length), 8)
    )
  }
  for (const f of failed) console.log(pad(f.file, 26) + '  (' + f.why + ')')
  console.log('')

  const grand = {}
  console.log(pad('tier', 17) + rpad('fns', 7) + rpad('same', 8) + rpad('same%', 8) + rpad('diverg', 8) + rpad('div%', 8) + rpad('winOnly', 9) + rpad('linOnly', 9))
  for (const tier of TIERS) {
    const t = tally(all, tier)
    grand[tier] = t
    console.log(
      pad(tier, 17) + rpad(total, 7) + rpad(t.fns.same, 8) + rpad(pct(t.fns.same, total), 8) +
      rpad(t.fns.divergent, 8) + rpad(pct(t.fns.divergent, total), 8) +
      rpad(t.fns['win-only'], 9) + rpad(t.fns['linux-only'], 9)
    )
  }
  console.log('')
  const totalLines = all.reduce((a, r) => a + r.lines, 0)
  console.log(pad('tier (LINES)', 17) + rpad('lines', 7) + rpad('same', 8) + rpad('same%', 8) + rpad('diverg', 8) + rpad('div%', 8) + rpad('winOnly', 9) + rpad('linOnly', 9))
  for (const tier of TIERS) {
    const t = grand[tier]
    console.log(
      pad(tier, 17) + rpad(totalLines, 7) + rpad(t.lines.same, 8) + rpad(pct(t.lines.same, totalLines), 8) +
      rpad(t.lines.divergent, 8) + rpad(pct(t.lines.divergent, totalLines), 8) +
      rpad(t.lines['win-only'], 9) + rpad(t.lines['linux-only'], 9)
    )
  }

  const notSame = all.filter((r) => r.tiers[HEAD] !== 'same')
  if (notSame.length > 0 && !selftest) {
    console.log('')
    console.log('every function that is not the same C on both targets at tier ' + HEAD + ':')
    for (const r of notSame) {
      console.log('  ' + pad(r.tiers[HEAD].toUpperCase(), 11) + pad(r.origin, 24) + r.name)
    }
  }

  if (SHOW !== null) {
    const hit = all.find((r) => r.name === SHOW)
    if (hit === undefined) console.log(NL + '--show ' + SHOW + ': no such function')
    else {
      console.log('')
      console.log('--- ' + hit.origin + '::' + hit.name + '   T0=' + hit.tiers['T0-raw'] +
        ' T1=' + hit.tiers['T1-same-value'] + ' T2=' + hit.tiers['T2-algorithmic'])
      console.log('--- ' + WIN + ':' + NL + (hit.bodyA ?? '(absent)'))
      console.log('--- ' + B + ':' + NL + (hit.bodyB ?? '(absent)'))
    }
  }

  const namesOut = flag('names', null)
  if (namesOut) {
    writeFileSync(namesOut, all.map((r) => r.tiers[HEAD] + ' ' + r.origin + ' ' + r.name).join(NL) + NL)
    console.log(NL + 'names -> ' + namesOut)
  }
  const jsonOut = flag('json', null)
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({
      A: WIN, B, selftest, total, totalLines, grand, failed,
      byOrigin: originRows.map(([origin, rs]) => ({ origin, n: rs.length, ...tally(rs, HEAD) })),
      functions: all.map((r) => ({ origin: r.origin, name: r.name, lines: r.lines, sightings: r.sightings, tiers: r.tiers }))
    }, null, 2))
    console.log('json -> ' + jsonOut)
  }

  if (selftest) {
    let bad = 0
    for (const tier of TIERS) {
      const t = grand[tier]
      bad += t.fns.divergent + t.fns['win-only'] + t.fns['linux-only']
    }
    console.log('')
    if (bad === 0 && total > 0) {
      console.log('SELFTEST PASS: ' + total + ' functions compared across ' + TIERS.length +
        ' tiers, 0 differences reported. The instrument can say "no difference".')
      process.exit(0)
    }
    console.log('SELFTEST FAIL: ' + bad + ' spurious differences across ' + total + ' functions.')
    for (const r of all.filter((x) => TIERS.some((t) => x.tiers[t] !== 'same')).slice(0, 40)) {
      console.log('  ' + r.origin + ' ' + r.name + ' ' + JSON.stringify(r.tiers))
    }
    process.exit(1)
  }
}

main()
