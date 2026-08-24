/**
 * rc-provenance.mjs - WHO created the reference that each release drops, and
 * how much of the unwind-ladder duplication is real.
 *
 * lines.mjs says how many emitted bytes are unwind epilogue. shapes.mjs says
 * which statement shape repeats most. Neither answers the question a fix
 * starts from: a release call site exists because some temp OWNS a reference,
 * and WHICH EMITTER PATH produced that reference decides what can be done
 * about it.
 *
 *   retain-local     a BORROW candidate - the source local outlives the temp,
 *                    so the retain and every release of it are removable by a
 *                    borrow, and a retain is INLINE (20 B on x86-64) while a
 *                    release is a call site (8.5 B), so a borrow is worth
 *                    about 39 B
 *   retain-field     a borrow candidate only under an escape analysis
 *   retain-global    same, if the global is never reassigned
 *   call-emitted     ownership transferred out of an emitted function; the
 *                    head-of-ladder release of such a temp is a provable
 *                    no-op, because an emitted function that unwinds returns
 *                    NULL
 *   call-runtime     ownership out of the runtime; the same head release is
 *                    a no-op only per-callee contract
 *   local-or-param   scope teardown, not a temp at all
 *
 * It also computes the SUFFIX-TRIE FLOOR of the unwind ladders per function:
 * the smallest number of lines a tail-merging transform could reach. That
 * number is what says whether emitter-side outlining is worth doing -- and on
 * zapo the answer measured out to "no", because the C compiler already
 * reaches it (two arms of the same function, one with the ladders written
 * inline and one hand-merged, compile to byte-identical .text at -O1, -O2,
 * -Os and -Oz).
 *
 * Usage: node rc-provenance.mjs --c file.c [--json out] [--top N]
 *        node rc-provenance.mjs --self-test
 *
 * Nothing here is run by the directory gate; it is a hand-run instrument and
 * `--self-test` stands in for a test file.
 */
import { createReadStream, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

/** A definition opens at column 0 and ends with `{`, then the emitter's
 *  provenance comment. Anchoring on a bare `{$` sees almost no function. */
export const FN_OPEN_RE = /^[A-Za-z_].*\{(?:\s*\/\*.*\*\/)?\s*$/
const DECL_RE = /^\s*(?:const\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\**\s*(sc_t\d+)\s*=\s*(.*?);\s*(?:\/\*.*\*\/)?\s*$/
const REL_RE =
  /^\s*(?:if \([^)]*\)\s*)?((?:scr|sc)_[A-Za-z0-9_]*(?:release|rrelease)[A-Za-z0-9_]*)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*;/

/** Classify a temp's initializer into the emitter path that produced it. */
export function classifyInit(init) {
  if (init === 'NULL' || init === '0') return 'null'
  const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(init)
  if (!call) {
    if (/^sc_t\d+$/.test(init)) return 'alias-temp'
    if (/^sc_(?:l|a|p)_/.test(init)) return 'alias-local'
    if (/^\(Scr[A-Za-z]+ \*\)&sc_(?:lit|unit)_\d+$/.test(init)) return 'immortal-static'
    return 'other'
  }
  const f = call[1]
  if (/(?:^|_)r?retain/.test(f)) {
    const inner = init.slice(f.length + 1, init.lastIndexOf(')'))
    if (/^sc_(?:l|a|p)_[A-Za-z0-9_]+$/.test(inner)) return 'retain-local'
    if (/^sc_t\d+$/.test(inner)) return 'retain-temp'
    if (/->/.test(inner)) return 'retain-field'
    if (/^sc_g_/.test(inner)) return 'retain-global'
    return 'retain-other'
  }
  if (/^sc_f__/.test(f)) return 'call-emitted'
  if (/^sc_/.test(f)) return 'call-emitted-helper'
  if (/^scr_/.test(f)) return 'call-runtime'
  return 'call-other'
}

/**
 * The suffix-trie cost of one function's unwind ladders.
 *
 * Each ladder is an array of normalised lines ending in its terminator
 * (`return X;` / `goto L;`). Ladders that end the same way share that tail,
 * so inserting them REVERSED into a trie and counting nodes gives exactly
 * the number of lines a tail-merged emission would write. One `goto` per
 * ladder is charged on top, which over-charges by one (the ladder that falls
 * through into its own tail needs none) and so never over-states the saving.
 */
export function suffixTrieCost(ladders) {
  let lines = 0
  for (const l of ladders) lines += l.length
  const root = new Map()
  let nodes = 0
  for (const lad of ladders) {
    let cur = root
    for (let i = lad.length - 1; i >= 0; i--) {
      let next = cur.get(lad[i])
      if (next === undefined) {
        next = new Map()
        cur.set(lad[i], next)
        nodes++
      }
      cur = next
    }
  }
  return { lines, nodes, gotos: ladders.length, cost: nodes + ladders.length }
}

export async function scan(cFile) {
  const rl = createInterface({ input: createReadStream(cFile, { encoding: 'utf8' }), crlfDelay: Infinity })
  let depth = 0
  let inLadder = 0
  let ladderIndent = -1
  let lastTemp = null
  let lastTempWasCall = false
  let temps = new Map()
  let capBody = null
  let fnLadders = []

  const byClass = new Map()
  const headByClass = new Map()
  let relTotal = 0
  let relUnknownTemp = 0
  let pendingChecks = 0
  let fallibleHeadRel = 0
  let ladderLines = 0
  let trieCost = 0
  let trieLines = 0
  let fnsWithLadders = 0

  const bump = (c, k) => {
    let e = byClass.get(c)
    if (!e) {
      e = { normal: 0, ladder: 0 }
      byClass.set(c, e)
    }
    e[k]++
  }
  const closeFn = () => {
    if (fnLadders.length > 0) {
      const t = suffixTrieCost(fnLadders)
      trieCost += t.cost
      trieLines += t.lines
      fnsWithLadders++
    }
    fnLadders = []
    temps = new Map()
    lastTemp = null
    inLadder = 0
  }

  for await (const raw of rl) {
    const line = raw.replace(/\r$/, '')
    if (depth === 0 && FN_OPEN_RE.test(line) && !/^typedef/.test(line)) {
      closeFn()
      depth = 1
      continue
    }
    if (depth > 0 && /^\}/.test(line)) {
      depth = 0
      closeFn()
      continue
    }
    if (depth === 0) continue

    const ind = line.length - line.trimStart().length
    if (inLadder && ind <= ladderIndent && /^\s*\}/.test(line)) {
      inLadder = 0
      if (capBody) {
        fnLadders.push(capBody)
        ladderLines += capBody.length
        capBody = null
      }
    }
    if (/if \(scr_exc_pending\(\)\) \{\s*$/.test(line)) {
      pendingChecks++
      inLadder = 1
      ladderIndent = ind
      capBody = []
      continue
    }
    if (inLadder && capBody) capBody.push(line.trim())

    const d = DECL_RE.exec(line)
    if (d && !inLadder) {
      const cls = classifyInit(d[2])
      temps.set(d[1], cls)
      lastTemp = d[1]
      lastTempWasCall = cls.startsWith('call-')
      continue
    }

    const r = REL_RE.exec(line)
    if (!r) continue
    relTotal++
    const arg = r[2]
    const where = inLadder ? 'ladder' : 'normal'
    if (/^sc_t\d+$/.test(arg)) {
      const cls = temps.get(arg)
      if (cls === undefined) relUnknownTemp++
      else bump(cls, where)
      if (inLadder && lastTempWasCall && arg === lastTemp) {
        fallibleHeadRel++
        headByClass.set(cls, (headByClass.get(cls) ?? 0) + 1)
      }
    } else if (/^sc_(?:l|a|p)_/.test(arg)) bump('local-or-param', where)
    else bump('other-name', where)
  }
  closeFn()
  return {
    file: cFile,
    relTotal,
    relUnknownTemp,
    pendingChecks,
    fallibleHeadRel,
    ladderLines,
    trieLines,
    trieCost,
    fnsWithLadders,
    byClass: [...byClass].sort((a, b) => b[1].normal + b[1].ladder - (a[1].normal + a[1].ladder)),
    headByClass: [...headByClass].sort((a, b) => b[1] - a[1]),
  }
}

const IS_MAIN = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
const argv = process.argv.slice(2)

if (IS_MAIN && argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)

if (IS_MAIN) {
  const cFile = argv[argv.indexOf('--c') + 1]
  if (!argv.includes('--c')) {
    console.error('usage: rc-provenance.mjs --c file.c [--json out]')
    console.error('       rc-provenance.mjs --self-test')
    process.exit(2)
  }
  const r = await scan(cFile)
  const tot = r.byClass.reduce((a, x) => a + x[1].normal + x[1].ladder, 0)
  console.log(`file                    ${cFile}`)
  console.log(`release statements      ${r.relTotal.toLocaleString()}   (temp not seen ${r.relUnknownTemp.toLocaleString()})`)
  console.log(`scr_exc_pending checks  ${r.pendingChecks.toLocaleString()}`)
  console.log(`unwind-ladder lines     ${r.ladderLines.toLocaleString()} in ${r.fnsWithLadders.toLocaleString()} functions`)
  console.log(
    `  suffix-trie floor     ${r.trieCost.toLocaleString()} = ${((100 * r.trieCost) / (r.trieLines || 1)).toFixed(1)}% of them (the most a tail merge could remove is the rest)`,
  )
  console.log(`head-of-ladder release of the may-throw call's OWN temp`)
  console.log(
    `                        ${r.fallibleHeadRel.toLocaleString()} (${((100 * r.fallibleHeadRel) / (r.pendingChecks || 1)).toFixed(1)}% of checks), by producer:`,
  )
  for (const [c, n] of r.headByClass) console.log(`    ${String(c).padEnd(22)}${n.toLocaleString().padStart(9)}`)
  console.log(`\nrelease sites by what PRODUCED the released reference:`)
  console.log(`  ${'class'.padEnd(22)}${'total'.padStart(10)}${'normal'.padStart(10)}${'ladder'.padStart(10)}   % of all`)
  for (const [c, e] of r.byClass) {
    const t = e.normal + e.ladder
    console.log(
      `  ${c.padEnd(22)}${t.toLocaleString().padStart(10)}${e.normal.toLocaleString().padStart(10)}${e.ladder.toLocaleString().padStart(10)}   ${((100 * t) / (tot || 1)).toFixed(1)}%`,
    )
  }
  if (argv.includes('--json')) writeFileSync(argv[argv.indexOf('--json') + 1], JSON.stringify(r, null, 1))
}

function selfTest() {
  let bad = 0
  const ok = (g, w, what) => {
    if (JSON.stringify(g) !== JSON.stringify(w)) {
      console.log(`FAIL ${what}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`)
      bad++
    } else console.log(`ok   ${what}`)
  }
  ok(classifyInit('scr_dyn_retain(sc_l_x_0)'), 'retain-local', 'retain of a local')
  ok(classifyInit('sc_rretain_r472(sc_l_msg_0)'), 'retain-local', 'record retain of a local')
  ok(classifyInit('scr_union_retain(sc_t2->sc_fld_p)'), 'retain-field', 'retain of a field')
  ok(classifyInit('scr_dyn_retain(sc_t7)'), 'retain-temp', 'retain of another temp')
  ok(classifyInit('scr_dyn_retain(sc_g_conf)'), 'retain-global', 'retain of a global')
  ok(classifyInit('sc_f__x25_m33_unwrap(sc_t0)'), 'call-emitted', 'call of an emitted function')
  ok(classifyInit('sc_ut_15(sc_t7)'), 'call-emitted-helper', 'call of an emitted helper')
  ok(classifyInit('scr_dyn_new_str(sc_lit_3)'), 'call-runtime', 'call of a runtime function')
  ok(classifyInit('NULL'), 'null', 'an uninitialized local')
  ok(classifyInit('sc_t4'), 'alias-temp', 'an alias of another temp')
  ok(classifyInit('sc_l_msg_0'), 'alias-local', 'an alias of a local')
  ok(classifyInit('(ScrStr *)&sc_lit_12'), 'immortal-static', 'an interned literal')
  ok(classifyInit('(ScrUnion *)&sc_unit_3'), 'immortal-static', 'an interned unit arm')

  ok(FN_OPEN_RE.test('static bool sc_f__a(int x) { /* a.ts:227 */'), true, 'open brace with provenance comment')
  ok(FN_OPEN_RE.test('static _Noreturn void sc_oom(void) {'), true, 'open brace with no comment')
  ok(FN_OPEN_RE.test('  ScrDyn *sc_t0 = f(x);'), false, 'an indented statement is not a definition')

  ok(DECL_RE.exec('  ScrDyn *sc_t3 = scr_dyn_retain(sc_l_a_0);')?.[1], 'sc_t3', 'decl names its temp')
  ok(DECL_RE.exec('  ScrDyn *sc_t3 = scr_dyn_retain(sc_l_a_0); /* a.ts:1 */')?.[2], 'scr_dyn_retain(sc_l_a_0)', 'decl strips the provenance comment')
  ok(DECL_RE.exec('  scr_dyn_release(sc_t3);'), null, 'a release is not a decl')
  ok(REL_RE.exec('    scr_dyn_release(sc_t3);')?.[2], 'sc_t3', 'release names its argument')
  ok(REL_RE.exec('  if (sc_t3) scr_str_release(sc_t3);')?.[2], 'sc_t3', 'a guarded release still names it')
  ok(REL_RE.exec('  scr_dyn_release(sc_t3->sc_fld_x);'), null, 'a field release is not a bare-name release')

  const A = ['r(a);', 'r(b);', 'return NULL;']
  const B = ['r(c);', 'r(b);', 'return NULL;']
  const C = ['r(z);', 'return 0;']
  const D = ['r(b);', 'return NULL;']
  ok(suffixTrieCost([A, A]).nodes, 3, 'identical ladders share every node')
  ok(suffixTrieCost([A, A]).lines, 6, 'identical ladders still cost 6 lines unmerged')
  ok(suffixTrieCost([A, B]).nodes, 4, 'a shared tail costs one extra node')
  ok(suffixTrieCost([A, C]).nodes, 5, 'disjoint ladders share nothing')
  ok(suffixTrieCost([A, D]).nodes, 3, 'a proper suffix adds no node')
  ok(suffixTrieCost([]).nodes, 0, 'an empty set costs nothing')
  ok(suffixTrieCost([A]).cost, 4, 'one ladder costs its lines plus its goto')

  console.log(bad === 0 ? '\nself-test: 29 passed, 0 failed' : `\nself-test: ${bad} failed`)
  return bad === 0
}
