/**
 * number-surface.mjs - Number -> string, byte-exact against Node, on BOTH
 * backends, for TWO compiler trees.
 *
 * WHY THIS AND NOT THE C ORACLE FILE. packages/runtime/test/number-cases.txt
 * already pins 51,523 doubles against Node, and the gate runs it. That test
 * calls `scr_f64_to_str` DIRECTLY from a C harness. It cannot see anything
 * the compiler does around the call: `String(x)`, `${x}`, `x.toString()`,
 * `JSON.stringify`, `-0` inside a container, a number used as a Map key, an
 * array joined. A change to the formatter that is right in C and wrong
 * through one of those paths would pass the C oracle and ship. This runs the
 * whole language surface end to end.
 *
 * WHAT IT DOES. Each program is run three ways -- Node v25.9.0 (the ORACLE)
 * and the compiled binary on the c and llvm backends, per tree -- and every
 * stdout/stderr/exit triple must match the oracle BYTE for byte.
 *
 *   MATCH        the arm reproduced the oracle exactly
 *   WRONG        it ran, exited 0, and printed something else  <- the one
 *                that matters: a wrong number printed is silent
 *   TRAP         it refused (non-zero exit, or a scriptc diagnostic)
 *   DID-NOT-RUN  it did not build, or it timed out
 *
 * ROUND-TRIP IS CHECKED INSIDE THE PROGRAMS, not by this driver. Every
 * program that formats a value also parses its own output back and prints
 * `rt=ok` or the offending pair. That makes the round-trip property part of
 * the byte-compared output rather than a second opinion this file holds:
 * if the parse disagrees, the oracle and the arm print different bytes and
 * the row reads WRONG.
 *
 * The verdict is the TRANSITION table between the two trees. N WRONG->MATCH
 * is a win, M MATCH->WRONG is a regression, and M must be zero.
 *
 * SELFTEST: --selftest puts the SAME tree in both slots; every row must come
 * back identical with zero transitions. Two negative controls run alongside,
 * because a scorer that only ever prints MATCH passes an A/A perfectly:
 *   - a CANARY scored against output no implementation produces (must read
 *     WRONG);
 *   - a REFUSAL program scriptc declines to compile (must read TRAP).
 * If either control does not land on its expected verdict the driver exits
 * non-zero and no other number it printed may be quoted.
 *
 * Every run has a timeout. A hung binary is DID-NOT-RUN, never a pass.
 *
 *   node tests/perf/f64str/number-surface.mjs --a <treeA> --b <treeB> --out <dir>
 *   node tests/perf/f64str/number-surface.mjs --a <tree> --selftest --out <dir>
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'

const NL = String.fromCharCode(10)
const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  if (i < 0) return d
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? '1' : v
}
const has = (n) => argv.includes('--' + n)

const TREE_A = flag('a')
const TREE_B = has('selftest') ? TREE_A : flag('b')
const OUT = path.resolve(flag('out', 'number-surface-out'))
/* The oracle is node v25.9.0, which is NOT the node on PATH (that is
 * v22.18.0). It must be named, never guessed. */
const ORACLE = flag('oracle', process.env['SCRIPTC_ORACLE_NODE'] ?? null)
if (ORACLE === null) {
  console.error('number-surface.mjs: no oracle node. Set SCRIPTC_ORACLE_NODE or pass --oracle <path>.')
  process.exit(2)
}
const BACKENDS = String(flag('backends', 'c,llvm')).split(',').filter(Boolean)
const TIMEOUT = Number.parseInt(flag('timeout', '240000'), 10)
const ONLY = flag('only', null)

if (TREE_A === null || TREE_B === null) {
  console.error('--a <tree> and --b <tree> are required (or --a with --selftest)')
  process.exit(2)
}

/* Shared preamble: a round-trip checker every program uses, so the property
 * "parsing the output returns the identical double" is printed rather than
 * assumed. Object.is, not ===, so -0 is distinguished from 0. */
const RT = `
function rt(x: number): string {
  const s = String(x)
  const back = Number(s)
  const ok = Number.isNaN(x) ? Number.isNaN(back) : Object.is(back, x)
  return ok ? s : s + "<<ROUNDTRIP-FAIL>>"
}
`

const PROGRAMS = {
  /* -0 prints "0" but Object.is distinguishes it, and JSON.stringify keeps
   * that distinction nowhere -- so the only way a -0 bug shows is through
   * the sign of a reparsed value. */
  'zero-and-negzero': RT + `
const z = 0
const nz = -0
console.log(rt(z) + "|" + rt(nz))
console.log(String(Object.is(z, nz)) + String(Object.is(nz, -0)) + String(z === nz))
console.log(JSON.stringify([0, -0, 1, -1]))
console.log(JSON.stringify({ a: 0, b: -0, c: -1 }))
const arr: number[] = [0, -0]
console.log(arr.join(",") + "|" + arr.map((v) => 1 / v).join(","))
console.log(String(1 / nz) + " " + String(1 / z))
console.log((-0).toString() + " " + (0).toFixed(2) + " " + (-0).toFixed(2))
`,

  /* Every exact integer length, both sides of 2^53, and the classic
   * 9007199254740993 which is not representable at all. */
  'integers': RT + `
const xs: number[] = [
  1, 9, 10, 99, 100, 999, 1000, 65535, 1000000, 123456789,
  2147483647, 4294967295, 9007199254740991, 9007199254740992,
  9007199254740993, 9007199254740994, 18014398509481984,
  1e15, 1e16, 1e17, 1e20, 1e21, 1e22,
  -1, -1000, -9007199254740991, -9007199254740992
]
for (const x of xs) console.log(rt(x))
console.log(String(Number.MAX_SAFE_INTEGER) + " " + String(Number.MIN_SAFE_INTEGER))
console.log(String(2 ** 53) + " " + String(2 ** 53 + 2) + " " + String(2 ** 63))
`,

  /* Everything at the edge of the format. */
  'extremes': RT + `
const xs: number[] = [
  Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE,
  Number.EPSILON, 2.2250738585072014e-308, 2.225073858507201e-308,
  5e-324, 1e-323, 4.9e-324, 1.7976931348623157e308
]
for (const x of xs) console.log(rt(x))
console.log(String(Number.MIN_VALUE / 2) + " " + String(Number.MAX_VALUE * 2))
`,

  'nonfinite': RT + `
const xs: number[] = [NaN, Infinity, -Infinity, 0 / 0, 1 / 0, -1 / 0]
for (const x of xs) console.log(rt(x))
console.log(JSON.stringify([NaN, Infinity, -Infinity]))
console.log(JSON.stringify({ a: NaN, b: Infinity }))
console.log(String(Number.NaN) + String(Number.POSITIVE_INFINITY) + String(Number.NEGATIVE_INFINITY))
`,

  /* Fixed placement switches to exponential at n > 21 and at n <= -6.
   * These are the two boundaries ECMA-262 6.1.6.1.20 names. */
  'notation-boundaries': RT + `
const xs: number[] = [
  1e-8, 1e-7, 1e-6, 1e-5, 0.000001, 0.0000001, 0.00000012345,
  1e19, 1e20, 1e21, 1e22, 1.2e21, 1.2e20,
  999999999999999999999, 1000000000000000000000, 1e-6 * 1.5, 123456e-10
]
for (const x of xs) console.log(rt(x))
`,

  /* The shortest-round-trip traps: the value a naive %.17g gets wrong. */
  'shortest-roundtrip': RT + `
const xs: number[] = [
  0.1, 0.2, 0.3, 0.1 + 0.2, 0.7, 1 / 3, 2 / 3, 0.5, 1.5, 2.5,
  1e23, 9.999999999999999e22, 1.0000000000000002, 5e-324,
  3.141592653589793, 2.718281828459045, 1.7976931348623155e308,
  123.456, 8.5, 35, 4.35e-9, 6.34e-8
]
for (const x of xs) console.log(rt(x))
`,

  /* Every path the LANGUAGE offers to a number's text, not just String(). */
  'spellings': RT + `
const x = 1234.5
const n = -0
console.log(String(x) + "|" + \`\${x}\` + "|" + x.toString() + "|" + ("" + x))
console.log(String(n) + "|" + \`\${n}\` + "|" + n.toString() + "|" + ("" + n))
console.log([1, 2.5, -0, NaN, Infinity].join("/"))
console.log(JSON.stringify({ k: x, j: [x, n] }))
console.log(x.toFixed(0) + " " + x.toFixed(3) + " " + x.toExponential(2) + " " + x.toPrecision(6))
console.log((255).toString(16) + " " + (255).toString(2) + " " + (0.5).toString(2))
const m = new Map<number, string>()
m.set(1, "a"); m.set(-0, "b"); m.set(NaN, "c")
console.log(String(m.size) + JSON.stringify([...m.keys()].map((k) => String(k))))
`,

  /* A deterministic sweep of RANDOM BIT PATTERNS. The PRNG is written out so
   * both arms generate the same doubles; the output is a checksum plus the
   * first failure, so one line covers 200k values without a 200k-line diff. */
  'bitpattern-sweep': `
const buf = new ArrayBuffer(8)
const f = new Float64Array(buf)
const u = new Uint32Array(buf)
let s0 = 123456789 >>> 0
let s1 = 362436069 >>> 0
function next(): number {
  let t = s0
  const s = s1
  s0 = s
  t ^= t << 11; t >>>= 0
  t ^= t >>> 8
  s1 = (t ^ s ^ (s >>> 19)) >>> 0
  return s1
}
let total = 0
let finite = 0
let chars = 0
let firstBad = ""
for (let i = 0; i < 200000; i++) {
  u[0] = next()
  u[1] = next()
  const x = f[0]
  total++
  if (!Number.isFinite(x)) continue
  finite++
  const str = String(x)
  chars += str.length
  const back = Number(str)
  if (!Object.is(back, x) && firstBad === "") firstBad = str
}
console.log("total=" + total + " finite=" + finite + " chars=" + chars)
console.log("firstBad=" + JSON.stringify(firstBad))
`,

  /* Exact integers across every digit length, which is the shape the fast
   * path claims and the shape a real program stringifies most. */
  'integer-sweep': `
let chars = 0
let bad = ""
for (let d = 0; d < 16; d++) {
  const base = 10 ** d
  for (let k = 0; k < 400; k++) {
    const x = base + k * 7
    const s = String(x)
    chars += s.length
    if (Number(s) !== x && bad === "") bad = s
    const nx = -x
    const ns = String(nx)
    chars += ns.length
    if (Number(ns) !== nx && bad === "") bad = ns
  }
}
console.log("chars=" + chars + " bad=" + JSON.stringify(bad))
let sum = 0
for (let i = 0; i < 2000; i++) sum += String(i).length
console.log("sum=" + sum)
console.log(String(0) + String(1) + String(10) + String(100) + String(99999))
`,

  /* JSON.stringify is where a protocol message's numbers actually go. */
  'json-numbers': `
type Msg = { id: number; ts: number; ratio: number; flags: number[]; neg: number }
const m: Msg = { id: 1, ts: 1755990000000, ratio: 0.3333333333333333, flags: [0, 1, 200, -0], neg: -0 }
console.log(JSON.stringify(m))
console.log(JSON.stringify(m, null, 2))
const parsed: Record<string, unknown> = JSON.parse(JSON.stringify(m))
console.log(JSON.stringify(parsed))
console.log(JSON.stringify([1e21, 1e-7, 5e-324, 9007199254740993]))
console.log(JSON.stringify({ a: [[1.5, [2.25]]], b: { c: 1e100 } }))
`,

  /* toFixed/toPrecision/toExponential and radix are SEPARATE code paths.
   * They are here as a control: a change to scr_f64_to_str must not move
   * them, and if it does, this row says so. */
  'other-formatters': `
const xs: number[] = [0, -0, 1.005, 1234.5678, 0.000001234, 1e21, 123456789]
for (const x of xs) {
  console.log(x.toFixed(0) + "|" + x.toFixed(2) + "|" + x.toFixed(6))
  console.log(x.toExponential() + "|" + x.toExponential(3))
  console.log(x.toPrecision(1) + "|" + x.toPrecision(8))
}
for (const r of [2, 8, 16, 36]) console.log((3735928559).toString(r) + "|" + (0.1).toString(r))
`
}

/* The two negative controls. Neither is counted in the totals. */
const CANARY_NAME = '(canary)'
const CANARY_SRC = 'console.log("canary")' + NL
const REFUSAL_NAME = '(refusal)'
/* A declaration scriptc refuses. If this ever COMPILES, the TRAP column
 * stops meaning anything and the driver says so rather than passing. */
const REFUSAL_SRC = 'const x: number = 1' + NL + 'console.log(x.thisMemberDoesNotExist())' + NL

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT, ...opts
  })
}

function triple(res) {
  if (res.error !== undefined && res.error !== null) {
    return { out: '', err: String(res.error.message), code: null, killed: true }
  }
  return {
    out: (res.stdout ?? '').replace(/\r\n/g, NL),
    err: (res.stderr ?? '').replace(/\r\n/g, NL),
    code: res.status,
    killed: res.signal !== null && res.signal !== undefined
  }
}

function same(a, b) { return a.out === b.out && a.err === b.err && a.code === b.code }

function score(oracle, arm, built, refused = false) {
  if (!built) return refused ? 'TRAP' : 'DID-NOT-RUN'
  if (arm.killed) return 'DID-NOT-RUN'
  if (same(oracle, arm)) return 'MATCH'
  if (arm.code !== 0) return 'TRAP'
  return 'WRONG'
}

function runArm(tree, name, src, backend, dir) {
  const cli = path.join(tree, 'packages', 'cli', 'dist', 'main.js')
  if (!existsSync(cli)) throw new Error('no CLI at ' + cli)
  const srcFile = path.join(dir, name + '.ts')
  const exe = path.join(dir, name + '-' + backend + '.exe')
  writeFileSync(srcFile, src)
  try { rmSync(exe, { force: true }) } catch { /* nothing to remove */ }
  const b = sh(process.execPath, [cli, 'build', path.basename(srcFile), '--backend', backend, '-o', exe], { cwd: dir })
  // EXISTENCE, not exit code and not mtime: a cache hit restores a binary
  // with its original timestamp.
  if (!existsSync(exe)) {
    const diag = /error SC\d{4}:/.test((b.stderr ?? '') + (b.stdout ?? ''))
    return {
      built: false, refused: diag,
      run: { out: '', err: ((b.stderr ?? '') + (b.stdout ?? '')).slice(-2000), code: b.status, killed: false }
    }
  }
  return { built: true, run: triple(sh(exe, [], { cwd: dir })) }
}

function main() {
  mkdirSync(OUT, { recursive: true })
  const names = ONLY === null ? Object.keys(PROGRAMS) : ONLY.split(',').map((s) => s.trim())
  const selftest = has('selftest')
  console.log('number-surface   oracle=' + ORACLE)
  console.log('  A=' + TREE_A)
  console.log('  B=' + TREE_B + (selftest ? '   (SELFTEST: the same tree in both slots)' : ''))
  console.log('  backends=' + BACKENDS.join(',') + '   programs=' + names.length + '   timeout=' + TIMEOUT + 'ms')

  const ov = sh(ORACLE, ['-v'])
  console.log('  oracle node ' + (ov.stdout ?? '').trim())
  if (!/^v25\./.test((ov.stdout ?? '').trim())) {
    console.log('  REFUSED: the oracle must be node v25.x; PATH node is not it.')
    process.exit(3)
  }

  const dirA = path.join(OUT, 'a')
  const dirB = path.join(OUT, 'b')
  const dirO = path.join(OUT, 'oracle')
  for (const d of [dirA, dirB, dirO]) mkdirSync(d, { recursive: true })

  const rows = []
  for (const name of names) {
    const src = PROGRAMS[name]
    if (src === undefined) { console.log('  unknown program ' + name); continue }
    const of = path.join(dirO, name + '.ts')
    writeFileSync(of, src)
    const oracle = triple(sh(ORACLE, ['--experimental-strip-types', of], { cwd: dirO }))
    for (const backend of BACKENDS) {
      const a = runArm(TREE_A, name, src, backend, dirA)
      const b = runArm(TREE_B, name, src, backend, dirB)
      rows.push({
        name, backend,
        a: score(oracle, a.run, a.built, a.refused === true),
        b: score(oracle, b.run, b.built, b.refused === true),
        oracleCode: oracle.code, aCode: a.run.code, bCode: b.run.code,
        aOut: a.run.out, bOut: b.run.out, oracleOut: oracle.out,
        aErr: a.run.err.slice(-600), bErr: b.run.err.slice(-600), oracleErr: oracle.err,
        /* a round-trip failure inside a program is a WRONG that would also
         * show as a byte diff; surfaced separately so it cannot hide. */
        aRt: /ROUNDTRIP-FAIL|firstBad="[^"]/.test(a.run.out),
        bRt: /ROUNDTRIP-FAIL|firstBad="[^"]/.test(b.run.out),
        oRt: /ROUNDTRIP-FAIL|firstBad="[^"]/.test(oracle.out)
      })
    }
  }

  /* control 1: the scorer can print WRONG */
  const canary = { name: CANARY_NAME, a: 'MATCH', b: 'MATCH' }
  {
    const cf = path.join(dirO, 'canary.ts')
    writeFileSync(cf, CANARY_SRC)
    const real = triple(sh(ORACLE, ['--experimental-strip-types', cf], { cwd: dirO }))
    const fake = { out: 'this is not what any implementation prints' + NL, err: '', code: 0, killed: false }
    canary.a = score(real, real, true)
    canary.b = score(real, fake, true)
  }

  /* control 2: the scorer can print TRAP, and scriptc still refuses what it
   * is supposed to refuse. Run on tree B only, on the first backend. */
  const refusal = { name: REFUSAL_NAME, verdict: 'DID-NOT-RUN' }
  {
    const rf = path.join(dirO, 'refusal.ts')
    writeFileSync(rf, REFUSAL_SRC)
    const oracleR = triple(sh(ORACLE, ['--experimental-strip-types', rf], { cwd: dirO }))
    const r = runArm(TREE_B, 'refusal', REFUSAL_SRC, BACKENDS[0], dirB)
    refusal.verdict = score(oracleR, r.run, r.built, r.refused === true)
  }

  const pad = (s, w) => String(s).padEnd(w)
  console.log('')
  console.log('  ' + pad('program', 24) + pad('backend', 9) + pad('A', 14) + 'B')
  for (const r of rows) {
    const mark = r.a === r.b ? '' : '   <-- ' + r.a + ' -> ' + r.b
    const rtmark = (r.aRt || r.bRt || r.oRt) ? '   ROUND-TRIP FAILURE' : ''
    console.log('  ' + pad(r.name, 24) + pad(r.backend, 9) + pad(r.a, 14) + r.b + mark + rtmark)
  }
  const canaryOk = canary.a === 'MATCH' && canary.b === 'WRONG'
  const refusalOk = refusal.verdict === 'TRAP'
  console.log('  ' + pad(CANARY_NAME, 24) + pad('-', 9) + pad(canary.a, 14) + canary.b +
    (canaryOk ? '   (the scorer CAN print WRONG)' : '   <-- THE SCORER IS BROKEN'))
  console.log('  ' + pad(REFUSAL_NAME, 24) + pad(BACKENDS[0], 9) + pad('-', 14) + refusal.verdict +
    (refusalOk ? '   (the scorer CAN print TRAP)' : '   <-- THE TRAP COLUMN IS BROKEN'))

  const count = (k, side) => rows.filter((r) => r[side] === k).length
  const trans = (from, to) => rows.filter((r) => r.a === from && r.b === to)
  const wrongToMatch = trans('WRONG', 'MATCH')
  const matchToWrong = trans('MATCH', 'WRONG')
  const matchToTrap = trans('MATCH', 'TRAP')
  const matchToDnr = trans('MATCH', 'DID-NOT-RUN')
  const bothTrap = rows.filter((r) => r.a === 'TRAP' && r.b === 'TRAP')
  const rtFail = rows.filter((r) => r.aRt || r.bRt)

  console.log('')
  for (const side of ['a', 'b']) {
    console.log('  ' + (side === 'a' ? 'A' : 'B') + ': ' +
      ['MATCH', 'WRONG', 'TRAP', 'DID-NOT-RUN'].map((k) => k + ' ' + count(k, side)).join('   '))
  }
  console.log('  transitions: ' + wrongToMatch.length + ' WRONG->MATCH, ' + matchToWrong.length +
    ' MATCH->WRONG, ' + matchToTrap.length + ' MATCH->TRAP, ' + matchToDnr.length + ' MATCH->DID-NOT-RUN')
  console.log('  round-trip failures in a compiled arm: ' + rtFail.length +
    (rtFail.length > 0 ? '  ' + rtFail.map((r) => r.name + '/' + r.backend).join(', ') : ''))
  if (bothTrap.length > 0) {
    console.log('  ' + bothTrap.length + ' TRAP on BOTH sides (pre-existing, not evidence either way): ' +
      bothTrap.map((r) => r.name + '/' + r.backend).join(', '))
  }
  for (const r of [...matchToWrong, ...matchToTrap, ...matchToDnr]) {
    console.log('')
    console.log('  REGRESSION ' + r.name + '/' + r.backend + '  ' + r.a + ' -> ' + r.b)
    console.log('    oracle: ' + JSON.stringify(r.oracleOut.slice(0, 600)))
    console.log('    B     : ' + JSON.stringify(r.bOut.slice(0, 600)) + '  exit ' + r.bCode)
    if (r.bErr) console.log('    B err : ' + JSON.stringify(r.bErr.slice(0, 400)))
  }

  writeFileSync(path.join(OUT, 'number-surface.json'), JSON.stringify({
    treeA: TREE_A, treeB: TREE_B, backends: BACKENDS, rows, canary, refusal
  }, null, 2))
  console.log('')
  console.log('json -> ' + path.join(OUT, 'number-surface.json'))

  if (!canaryOk) { console.log('SCORER BROKEN: the canary did not read WRONG.'); process.exit(1) }
  if (!refusalOk) { console.log('SCORER BROKEN: the refusal control did not read TRAP.'); process.exit(1) }
  if (selftest) {
    const moved = rows.filter((r) => r.a !== r.b)
    if (moved.length === 0) {
      console.log('SELFTEST PASS: ' + rows.length + ' program/backend pairs, the same tree twice, 0 moved.')
      process.exit(0)
    }
    console.log('SELFTEST FAIL: ' + moved.length + ' moved with nothing to move them.')
    process.exit(1)
  }
  const bad = matchToWrong.length + matchToTrap.length + matchToDnr.length + rtFail.length
  process.exit(bad === 0 ? 0 : 1)
}

main()
