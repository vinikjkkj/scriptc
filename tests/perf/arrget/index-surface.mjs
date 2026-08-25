/**
 * index-surface.mjs - the ARRAY INDEX, byte-exact against Node, on BOTH
 * backends, for TWO compilers.
 *
 * WHY. `a[i]` is the most common thing a program does, and the check in
 * front of it is the most dangerous thing to make faster. Every index
 * arrives as a DOUBLE: -0 is index 0, an integral double from division is
 * an index, 1 + 1ulp is not, NaN is not, 2^53 is where an integer round
 * trip stops being exact, and JS answers `undefined` for all the ones that
 * are not while scriptc REFUSES. A change to that check that is 40% faster
 * and one value wrong is worse than no change at all, and the way it would
 * be wrong is silent: a refusal replaced by a value, or an index quietly
 * truncated to its neighbour.
 *
 * WHAT IT DOES. Each program below is run four ways -- Node (the ORACLE),
 * and the compiled binary on the c and llvm backends, for each compiler
 * tree given -- and every stdout/stderr/exit triple must match the oracle
 * BYTE for byte.
 *
 *   MATCH        the arm reproduced the oracle exactly
 *   WRONG        it ran, exited 0, and printed something else  <- the one
 *                that matters: a refusal replaced by a wrong answer
 *   TRAP         it refused (non-zero exit, or a scriptc diagnostic)
 *   DID-NOT-RUN  it did not build, or it timed out
 *
 * NINE of the programs are OUT-OF-RANGE reads, and every one of them is
 * expected to be TRAP on both sides: JS answers `undefined` there and
 * scriptc has no representation for it (SEMANTICS.md), so the refusal is
 * the documented behaviour rather than a failure. They are not counted as
 * passes. They are here because TRAP -> WRONG is precisely the transition
 * a faster index check can cause, and nothing else in the suite can see it.
 *
 * The verdict is the TRANSITION table between two compilers: N WRONG->MATCH
 * is a win, M MATCH->WRONG is a regression, and M must be zero.
 *
 * Every index is RUNTIME-VALUED (through process.env, or arithmetic on a
 * value that is) so the frontend cannot fold it, refuse it at compile time,
 * or hoist the check away. An inert program and a correct one print the
 * same thing.
 *
 * SELFTEST: --selftest runs the SAME tree in both slots. Every program must
 * come back with an identical verdict and zero transitions in either
 * direction. It also scores one program against output no implementation
 * produces, so the scorer is shown to be capable of printing WRONG at all
 * -- a scorer that only ever prints MATCH passes an A/A perfectly.
 *
 * Every run has a timeout. A hung binary is DID-NOT-RUN, never a pass.
 *
 *   node tests/perf/arrget/index-surface.mjs --a <treeA> --b <treeB> --out <dir>
 *   node tests/perf/arrget/index-surface.mjs --a <tree> --selftest --out <dir>
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
const OUT = path.resolve(flag('out', 'index-surface-out'))
/* The oracle is node v25.9.0, which is NOT the node on PATH (that is v22.18.0)
 * and has no discoverable location. It must be named, never guessed: silently
 * falling back to PATH would compare against the wrong runtime and read as ~20
 * regressions. Set SCRIPTC_ORACLE_NODE or pass --oracle. */
const ORACLE = flag('oracle', process.env['SCRIPTC_ORACLE_NODE'] ?? null)
if (ORACLE === null) {
  console.error('index-surface.mjs: no oracle node. Set SCRIPTC_ORACLE_NODE or pass --oracle <path>.')
  console.error('  The oracle is node v25.9.0; the node on PATH is v22.18.0 and is NOT it.')
  process.exit(2)
}
const BACKENDS = String(flag('backends', 'c,llvm')).split(',').filter(Boolean)
const TIMEOUT = Number.parseInt(flag('timeout', '180000'), 10)
const ONLY = flag('only', null)

if (TREE_A === null || TREE_B === null) {
  console.error('--a <tree> and --b <tree> are required (or --a with --selftest)')
  process.exit(2)
}

/* The programs. Every one of them allocates through scr_cyc_alloc: a dyn
 * object, a closure, a box, an array or a map. Where a case is only
 * reachable through the checked-dynamic path it is written with an
 * explicit `Record<string, ...>` or a JSON.parse, because a statically
 * typed `{a, b}` compiles to a static record and would not enter the dyn
 * path at all - a mis-calibrated program and an inert one produce the same
 * clean null. */
/* The programs. Every one of them puts a double into scr_arr_check_index,
 * and every index is RUNTIME-VALUED (it comes through process.env or through
 * arithmetic on a value that does) so nothing here is a compile-time
 * constant the frontend can fold or refuse before the runtime is reached: a
 * program that never runs the check and a program that runs it correctly
 * both print the right answer. */
const PROGRAMS = {
  // ── the accepting side ────────────────────────────────────────────────
  'read-every-form': `
const n = Number(process.env["ARR_N"] ?? "8")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i * 10)
console.log(a[0] + " " + a[n - 1] + " " + a[Number(process.env["ARR_I"] ?? "3")])
console.log(String(a.at(0)) + " " + String(a.at(-1)) + " " + String(a.at(n - 1)))
const [p, q, ...rest] = a
console.log(p + " " + q + " " + rest.length + " " + rest[0])
console.log(JSON.stringify([...a]))
console.log(JSON.stringify(a.slice(1, n - 1)))
let s = 0
for (const v of a) s += v
console.log("forof " + s)
console.log(JSON.stringify(a))
`,
  'minus-zero-index': `
// JS: a[-0] IS a[0]. ToPropertyKey(-0) is "0", and an index that arrives as
// a double carrying the sign bit must not be mistaken for a negative one.
const n = Number(process.env["ARR_N"] ?? "4")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i + 1)
const z = -0
console.log(String(a[z]))
console.log(String(a[z * 1]))
console.log(String(a[0 * Number(process.env["ARR_NEG"] ?? "-1")]))
console.log(String(Object.is(z, -0)))
console.log(String(a.at(z)))
`,
  'computed-integral-index': `
// Every index below is an integral double that arrived by arithmetic, not
// as an integer literal: division, subtraction, floor, round, a modulo, and
// a bitwise AND. All of them must be indices.
const n = Number(process.env["ARR_N"] ?? "16")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i * 3)
const k = Number(process.env["ARR_K"] ?? "8")
console.log(String(a[k / 2]))
console.log(String(a[k - 1]))
console.log(String(a[Math.floor(k / 3)]))
console.log(String(a[Math.round(k / 3)]))
console.log(String(a[k % 5]))
console.log(String(a[k & (n - 1)]))
console.log(String(a[Math.trunc(k * 1.5) - k]))
console.log(String(a[n - 1 - (k >> 2)]))
`,
  'index-2p20-array': `
// A big-but-ordinary array: 2^20 slots, read at the two ends and along a
// stride, so the index spends its life well past anything a 32-bit int
// would hold and still lands exactly.
const n = Number(process.env["ARR_N"] ?? "1048576")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
let s = 0
for (let i = 0; i < n; i += 4093) s += a[i]
console.log(a[0] + " " + a[n - 1] + " " + s)
console.log(String(a.at(-1)) + " " + String(a.at(0)))
`,
  'boundary-walk': `
// The read boundary is len - 1 and the write boundary is len. Walk right up
// to each of them from inside; the ones just past are separate programs
// because they abort.
const n = Number(process.env["ARR_N"] ?? "32")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
let last = -1
for (let i = 0; i < a.length; i++) last = a[i]
console.log("last " + last)
a[a.length] = 999          // i === len appends
console.log(a.length + " " + a[a.length - 1])
a[a.length - 1] = 1000     // and the same slot overwrites
console.log(a.length + " " + a[a.length - 1])
console.log(JSON.stringify(a.slice(a.length - 3)))
`,
  'length-after-write': `
// The length that CLEARS. \`a.length = n\` for n > 0 has no lowering in this
// tree (SC2020, a compile-time refusal that predates any of this), but
// \`a.length = 0\` is the supported spelling and it is the one that matters
// here: it moves len under a live \`data\` pointer, so every subsequent index
// is validated against a limit that changed without the buffer moving.
const n = Number(process.env["ARR_N"] ?? "6")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
console.log(a.length + " " + String(a[a.length - 1]))
a.length = 0
console.log(a.length + " " + JSON.stringify(a))
for (let i = 0; i < n + 2; i++) a.push(i * 5)
console.log(a.length + " " + String(a[0]) + " " + String(a[a.length - 1]))
console.log(JSON.stringify(a.slice(0, a.length)))
console.log(String(a.at(-1)) + " " + String(a.at(0)))
`,
  'string-array-index': `
// The ref-element accessor takes the same index path with a retain on top.
const n = Number(process.env["ARR_N"] ?? "5")
const a: string[] = []
for (let i = 0; i < n; i++) a.push("s" + i)
console.log(a[0] + " " + a[n - 1] + " " + a[Number(process.env["ARR_I"] ?? "2")])
console.log(String(a.at(-1)))
console.log(JSON.stringify(a))
console.log(a.join(","))
let t = ""
for (const s of a) t += s
console.log(t)
`,
  'nested-array-index': `
const n = Number(process.env["ARR_N"] ?? "4")
const rows: number[][] = []
for (let i = 0; i < n; i++) { const r: number[] = []; for (let j = 0; j < n; j++) r.push(i * n + j); rows.push(r) }
let s = 0
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += rows[i][j]
console.log(s + " " + rows[n - 1][n - 1] + " " + rows[0][0])
console.log(JSON.stringify(rows))
`,

  // ── the refusing side: a documented divergence, so TRAP on both sides ──
  // JS answers undefined for every one of these; scriptc refuses. Each is
  // here so that a change which turned a refusal into a WRONG ANSWER --
  // the silent failure this whole exercise risks -- shows up as TRAP->WRONG.
  'oob-past-end': `
const n = Number(process.env["ARR_N"] ?? "3")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
console.log("before")
console.log(String(a[n]))
console.log("NOT REACHED")
`,
  'oob-negative': `
const n = Number(process.env["ARR_N"] ?? "3")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
console.log("before")
console.log(String(a[-1 * Number(process.env["ARR_ONE"] ?? "1")]))
console.log("NOT REACHED")
`,
  'oob-nan': `
const n = Number(process.env["ARR_N"] ?? "3")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
console.log("before")
console.log(String(a[Number(process.env["ARR_NAN"] ?? "not-a-number")]))
console.log("NOT REACHED")
`,
  'oob-fractional': `
const n = Number(process.env["ARR_N"] ?? "3")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
console.log("before")
console.log(String(a[Number(process.env["ARR_HALF"] ?? "1.5")]))
console.log("NOT REACHED")
`,
  'oob-2p32': `
const n = Number(process.env["ARR_N"] ?? "3")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
console.log("before")
console.log(String(a[Number(process.env["ARR_BIG"] ?? "4294967296")]))
console.log("NOT REACHED")
`,
  'oob-2p53': `
// The fast window's own edge. 2^53 is the first double at which the
// integer round trip stops being exact, so it is the one value where the
// two arms of the check could disagree.
const n = Number(process.env["ARR_N"] ?? "3")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
console.log("before")
console.log(String(a[Number(process.env["ARR_HUGE"] ?? "9007199254740992")]))
console.log("NOT REACHED")
`,
  'oob-infinity': `
const n = Number(process.env["ARR_N"] ?? "3")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
console.log("before")
console.log(String(a[Number(process.env["ARR_INF"] ?? "Infinity")]))
console.log("NOT REACHED")
`,
  'oob-empty': `
const a: number[] = []
const n = Number(process.env["ARR_N"] ?? "0")
for (let i = 0; i < n; i++) a.push(i)
console.log("before " + a.length)
console.log(String(a[0]))
console.log("NOT REACHED")
`,
  'oob-at-length': `
const n = Number(process.env["ARR_N"] ?? "3")
const a: number[] = []
for (let i = 0; i < n; i++) a.push(i)
console.log("before " + a.length)
console.log(String(a[a.length]))
console.log("NOT REACHED")
`
}

/* The negative control. Its expected output is deliberately not what any
 * correct implementation prints, so a run of --selftest proves the scorer
 * can print WRONG. It is scored apart and never counted in the totals. */
const CANARY_NAME = '(canary)'
const CANARY_SRC = 'console.log("canary")' + NL

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
  // with its original timestamp, and a build that "succeeded" and wrote
  // nothing is DID-NOT-RUN rather than a pass.
  if (!existsSync(exe)) {
    /* A build that failed with a scriptc DIAGNOSTIC is a refusal, and a
     * refusal is a legitimate answer -- the loud one. Anything else (a
     * crashed compiler, a timeout, a missing toolchain) is DID-NOT-RUN.
     * Collapsing the two would let a compiler that stopped compiling read
     * as a compiler that correctly declined. */
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
  console.log('index-surface   oracle=' + ORACLE)
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
        oracleCode: oracle.code,
        aCode: a.run.code, bCode: b.run.code,
        aOut: a.run.out, bOut: b.run.out, oracleOut: oracle.out,
        aErr: a.run.err.slice(-600), bErr: b.run.err.slice(-600), oracleErr: oracle.err
      })
    }
  }

  // the canary: prove the scorer can print WRONG
  const canary = { name: CANARY_NAME, backend: '-', a: 'MATCH', b: 'MATCH' }
  {
    const cf = path.join(dirO, 'canary.ts')
    writeFileSync(cf, CANARY_SRC)
    const real = triple(sh(ORACLE, ['--experimental-strip-types', cf], { cwd: dirO }))
    const fake = { out: 'this is not what any implementation prints' + NL, err: '', code: 0, killed: false }
    canary.a = score(real, real, true)
    canary.b = score(real, fake, true)
  }

  const pad = (s, w) => String(s).padEnd(w)
  console.log('')
  console.log('  ' + pad('program', 24) + pad('backend', 9) + pad('A', 14) + 'B')
  for (const r of rows) {
    const mark = r.a === r.b ? '' : '   <-- ' + r.a + ' -> ' + r.b
    console.log('  ' + pad(r.name, 24) + pad(r.backend, 9) + pad(r.a, 14) + r.b + mark)
  }
  console.log('  ' + pad(CANARY_NAME, 24) + pad('-', 9) + pad(canary.a, 14) + canary.b +
    (canary.a === 'MATCH' && canary.b === 'WRONG' ? '   (the scorer CAN print WRONG)' : '   <-- THE SCORER IS BROKEN'))

  const count = (k, side) => rows.filter((r) => r[side] === k).length
  const trans = (from, to) => rows.filter((r) => r.a === from && r.b === to)
  const wrongToMatch = trans('WRONG', 'MATCH')
  const matchToWrong = trans('MATCH', 'WRONG')
  const matchToTrap = trans('MATCH', 'TRAP')
  const matchToDnr = trans('MATCH', 'DID-NOT-RUN')
  const bothTrap = rows.filter((r) => r.a === 'TRAP' && r.b === 'TRAP')

  console.log('')
  for (const side of ['a', 'b']) {
    console.log('  ' + (side === 'a' ? 'A' : 'B') + ': ' +
      ['MATCH', 'WRONG', 'TRAP', 'DID-NOT-RUN'].map((k) => k + ' ' + count(k, side)).join('   '))
  }
  console.log('  transitions: ' + wrongToMatch.length + ' WRONG->MATCH, ' + matchToWrong.length +
    ' MATCH->WRONG, ' + matchToTrap.length + ' MATCH->TRAP, ' + matchToDnr.length + ' MATCH->DID-NOT-RUN')
  if (bothTrap.length > 0) {
    console.log('  ' + bothTrap.length + ' TRAP on BOTH sides (pre-existing, not evidence either way): ' +
      bothTrap.map((r) => r.name + '/' + r.backend).join(', '))
  }
  for (const r of [...matchToWrong, ...matchToTrap, ...matchToDnr]) {
    console.log('')
    console.log('  REGRESSION ' + r.name + '/' + r.backend + '  ' + r.a + ' -> ' + r.b)
    console.log('    oracle: ' + JSON.stringify(r.oracleOut.slice(0, 400)))
    console.log('    B     : ' + JSON.stringify(r.bOut.slice(0, 400)) + '  exit ' + r.bCode)
    if (r.bErr) console.log('    B err : ' + JSON.stringify(r.bErr.slice(0, 400)))
  }

  writeFileSync(path.join(OUT, 'index-surface.json'), JSON.stringify({
    treeA: TREE_A, treeB: TREE_B, backends: BACKENDS, rows, canary
  }, null, 2))
  console.log('')
  console.log('json -> ' + path.join(OUT, 'index-surface.json'))

  const canaryOk = canary.a === 'MATCH' && canary.b === 'WRONG'
  if (!canaryOk) { console.log('SCORER BROKEN: the canary did not read WRONG.'); process.exit(1) }
  if (selftest) {
    const moved = rows.filter((r) => r.a !== r.b)
    if (moved.length === 0) {
      console.log('SELFTEST PASS: ' + rows.length + ' program/backend pairs, the same tree twice, 0 moved.')
      process.exit(0)
    }
    console.log('SELFTEST FAIL: ' + moved.length + ' moved with nothing to move them.')
    process.exit(1)
  }
  const bad = matchToWrong.length + matchToTrap.length + matchToDnr.length
  process.exit(bad === 0 ? 0 : 1)
}

main()
