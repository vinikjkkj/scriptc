/**
 * surface.mjs - the object surface over the allocator, byte-exact against
 * Node, on BOTH backends, for TWO compilers.
 *
 * WHY. `scr_cyc_alloc` is under every cycle-headered object in the
 * language: every dyn value, every closure, every box, every record shape,
 * every array, every map. A change to it that is 45% faster and 0.001%
 * wrong is worse than no change, and the way it would be wrong is silent -
 * a field that reads back as zero because the payload zeroing moved, or a
 * key that comes out in the wrong order because a block was recycled from
 * the wrong class. A refusal is loud; a wrong answer is not.
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
 * The verdict is the TRANSITION table between two compilers, because that
 * is the question a change asks: N WRONG->MATCH is a win, M MATCH->WRONG is
 * a regression, and M must be zero. A program that was TRAP on both sides
 * is not evidence of anything and is reported as such rather than counted
 * as a pass.
 *
 * SELFTEST: --selftest runs the SAME tree in both slots. Every program must
 * come back with an identical verdict and zero transitions in either
 * direction. An instrument that cannot say "no difference" cannot be
 * believed when it says there is one. It also runs one program whose
 * expected output is deliberately WRONG, so the scorer is shown to be
 * capable of printing WRONG at all -- a scorer that only ever prints MATCH
 * passes an A/A perfectly.
 *
 * Every run has a timeout. A hung binary is DID-NOT-RUN, never a pass.
 *
 *   node tests/perf/cycalloc/surface.mjs --a <treeA> --b <treeB> --out <dir>
 *   node tests/perf/cycalloc/surface.mjs --a <tree> --selftest --out <dir>
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
const OUT = path.resolve(flag('out', 'surface-out'))
/* The oracle is node v25.9.0, which is NOT the node on PATH (that is v22.18.0)
 * and has no discoverable location. It must be named, never guessed: silently
 * falling back to PATH would compare against the wrong runtime and read as ~20
 * regressions. Set SCRIPTC_ORACLE_NODE or pass --oracle. */
const ORACLE = flag('oracle', process.env['SCRIPTC_ORACLE_NODE'] ?? null)
if (ORACLE === null) {
  console.error('surface.mjs: no oracle node. Set SCRIPTC_ORACLE_NODE or pass --oracle <path>.')
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
const PROGRAMS = {
  'keys-order': `
const o: Record<string, number> = JSON.parse('{"b":1,"2":2,"a":3,"10":4,"1":5}')
o["c"] = 6
o["0"] = 7
console.log(JSON.stringify(Object.keys(o)))
for (const k in o) console.log("in " + k + "=" + o[k])
console.log(JSON.stringify(o))
`,
  'json-roundtrip': `
const src = '{"n":1,"s":"x","b":true,"z":null,"a":[1,2,{"k":"v"}],"o":{"p":{"q":9}}}'
const o: Record<string, unknown> = JSON.parse(src)
console.log(JSON.stringify(o))
console.log(JSON.stringify(o, null, 2))
console.log(JSON.stringify(Object.keys(o)))
`,
  'spread-assign': `
const a: Record<string, number> = JSON.parse('{"x":1,"y":2}')
const b: Record<string, number> = JSON.parse('{"y":9,"z":3}')
const c = { ...a, ...b }
console.log(JSON.stringify(c))
const d = Object.assign({}, a, b)
console.log(JSON.stringify(d))
console.log(JSON.stringify(Object.keys(c)) + JSON.stringify(Object.keys(d)))
`,
  'structured-clone': `
const o: Record<string, unknown> = JSON.parse('{"a":[1,2,3],"b":{"c":"d"},"e":null}')
const k = structuredClone(o)
console.log(JSON.stringify(k))
console.log(String(k === o))
console.log(JSON.stringify(Object.keys(k)))
`,
  'inspect-dyn': `
import { inspect } from "node:util"
const o: Record<string, unknown> = JSON.parse('{"a":1,"b":[1,2],"c":{"d":"e"}}')
console.log(inspect(o))
console.log(inspect([o, o]))
console.log(inspect({ n: 1, s: "x", t: true }))
`,
  'deep-strict-equal': `
import { deepStrictEqual } from "node:assert"
type P = { a: number; b: number[] }
const o: P = { a: 1, b: [1, 2] }
const p: P = { a: 1, b: [1, 2] }
deepStrictEqual(o, p)
console.log("deepStrictEqual ok")
try {
  const q: P = { a: 2, b: [1, 2] }
  deepStrictEqual(o, q)
  console.log("NOT REACHED")
} catch (e) {
  console.log("threw " + (e instanceof Error ? e.name : "?"))
}
deepStrictEqual([1, 2, 3], [1, 2, 3])
console.log("arrays ok")
`,
  'deep-strict-equal-dyn': `
// The REFUSAL control. scriptc has no deep comparison for index-signature
// records (their key sets are dynamic) and says so at compile time. This
// program must stay a TRAP on both sides: it is here so a run that scores
// everything MATCH is visibly not scoring, and so a change that turned this
// refusal into a wrong answer would be caught.
import { deepStrictEqual } from "node:assert"
const o: Record<string, unknown> = JSON.parse('{"a":1}')
const p: Record<string, unknown> = JSON.parse('{"a":1}')
deepStrictEqual(o, p)
console.log("NOT REACHED")
`,
  'closure-box-churn': `
// a captured box and a closure per iteration: the two allocations
// scr_cyc_alloc's own comment names as its hottest pair.
let acc = 0
const fns: Array<(x: number) => number> = []
for (let i = 0; i < 5000; i++) {
  let base = i
  const f = (x: number): number => { base = base + x; return base }
  acc += f(1)
  if (i % 1000 === 0) fns.push(f)
}
console.log(acc)
for (const f of fns) console.log(f(2))
`,
  'map-array-churn': `
const m = new Map<string, number[]>()
for (let i = 0; i < 3000; i++) {
  const a: number[] = []
  for (let j = 0; j < 4; j++) a.push(i * j)
  m.set("k" + (i % 700), a)
}
let s = 0
for (const [k, v] of m) { s += k.length; for (const n of v) s += n }
console.log(m.size + " " + s)
`,
  'delete-and-readd': `
const o: Record<string, number> = JSON.parse('{"a":1,"b":2,"c":3}')
delete o["b"]
o["b"] = 4
o["d"] = 5
console.log(JSON.stringify(o))
console.log(JSON.stringify(Object.keys(o)))
console.log(JSON.stringify(Object.entries(o)))
console.log(JSON.stringify(Object.values(o)))
`,
  'nested-cycle': `
// a real reference cycle, so the collector's trace/teardown pair runs over
// blocks this change stamps.
type N = { id: number; next: N | null }
function build(n: number): N {
  const head: N = { id: 0, next: null }
  let cur = head
  for (let i = 1; i < n; i++) { const x: N = { id: i, next: null }; cur.next = x; cur = x }
  cur.next = head
  return head
}
let total = 0
for (let r = 0; r < 400; r++) {
  const h = build(20)
  let c: N = h
  for (let i = 0; i < 20; i++) { total += c.id; c = c.next as N }
}
console.log(total)
`,
  'big-and-small-classes': `
// straddles SCR_POOL_MAX: the small objects are pooled, the wide ones are
// not, and the blk field has to send each back to the right place.
const out: string[] = []
for (let r = 0; r < 300; r++) {
  const small: Record<string, number> = JSON.parse('{"a":1}')
  const wide: Record<string, number> = JSON.parse(
    '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"j":10,' +
    '"k":11,"l":12,"m":13,"n":14,"o":15,"p":16,"q":17,"r":18,"s":19,"t":20}')
  if (r === 0) { out.push(JSON.stringify(small)); out.push(JSON.stringify(wide)) }
  small["b"] = r
  wide["u"] = r
}
console.log(out.join("|"))
`,
  'error-and-throw': `
class Boom extends Error {}
function f(n: number): number { if (n > 3) throw new Boom("deep " + n); return n }
let seen = 0
for (let i = 0; i < 500; i++) {
  try { seen += f(i % 6) } catch (e) { seen += (e as Error).message.length }
}
console.log(seen)
`,
  'freeze-and-keys': `
const o: Record<string, number> = JSON.parse('{"z":1,"a":2,"3":3}')
Object.freeze(o)
console.log(JSON.stringify(Object.keys(o)))
console.log(JSON.stringify(o))
const p = { ...o }
console.log(JSON.stringify(Object.keys(p)))
console.log(JSON.stringify(Object.entries(p)))
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
  console.log('surface   oracle=' + ORACLE)
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

  writeFileSync(path.join(OUT, 'surface.json'), JSON.stringify({
    treeA: TREE_A, treeB: TREE_B, backends: BACKENDS, rows, canary
  }, null, 2))
  console.log('')
  console.log('json -> ' + path.join(OUT, 'surface.json'))

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
