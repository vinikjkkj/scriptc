/**
 * epimerge.mjs - how much of the emitted C's exception-unwind epilogue is
 * REDUNDANT, measured three ways on the real file.
 *
 * The emitter writes, at every fallible call site:
 *
 *     if (scr_exc_pending()) {
 *       <release every live value, innermost first>
 *       return NULL;            (or `goto sc_catch_N;`)
 *     }
 *
 * Three costs are counted per top-level definition:
 *
 *   now      every epilogue body line, as emitted today
 *   dedup    share ONE landing pad per DISTINCT body text; each site pays
 *            one `goto` line. cost = sum(distinct body sizes) + nsites
 *   chain    one pad per distinct release STATEMENT, falling through to the
 *            next: cost = distinct release statements + distinct
 *            terminators + nsites gotos. This is the `goto sc_unwind_k;`
 *            chain shape estado-imagesize.md section 8 names.
 *
 * `chain` is a LOWER BOUND on lines, not a promise: it is only reachable
 * when the release lists of a function nest (each list a suffix-extension
 * of the previous). `nest` reports how often they actually do.
 *
 * Usage: node epimerge.mjs --c file.c [--top 20]
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const path = flag('c')
if (!path) { console.error('usage: --c file.c'); process.exit(2) }
const TOP = Number(flag('top', '20'))

const text = readFileSync(path, 'latin1')
const N = text.length
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// Walk lines once. Track top-level definition boundaries the way cscan does:
// a definition starts at column 0 and closes on a line that is exactly `}`.
let i = 0
let defStart = 0
let defName = null

let totalLines = 0
let sites = 0, bodyLines = 0, bodyBytes = 0
let dedupLines = 0, dedupBytes = 0
let chainLines = 0, chainBytes = 0
let nestOk = 0, nestBad = 0
let guardLines = 0, guardBytes = 0

// per-definition state
let dBodies = new Map()      // body text -> {n, bytes}
let dRelease = new Map()     // single release stmt -> bytes
let dTerm = new Map()        // terminator stmt -> bytes
let dSites = 0
let dLists = []              // array of arrays of release stmts, in emission order
const perDef = []

function flushDef(name, endOff) {
  if (dSites > 0) {
    let dedupB = 0
    for (const [t, v] of dBodies) dedupB += v.bytes
    let chainB = 0
    for (const [, b] of dRelease) chainB += b
    for (const [, b] of dTerm) chainB += b
    // a goto line costs about `      goto sc_unwind_12;\n`
    const gotoBytes = dSites * 24
    // nesting check: is each list a suffix-extension of some earlier one?
    for (let k = 1; k < dLists.length; k++) {
      const a = dLists[k - 1], b = dLists[k]
      const short = a.length <= b.length ? a : b
      const long = a.length <= b.length ? b : a
      // suffix-extension: the shorter is a SUFFIX of the longer (inner
      // frames release first, so an outer list is the tail of an inner one)
      let ok = true
      for (let j = 0; j < short.length; j++) {
        if (short[short.length - 1 - j] !== long[long.length - 1 - j]) { ok = false; break }
      }
      if (ok) nestOk++; else nestBad++
    }
    perDef.push({
      name, sites: dSites,
      now: dBodies.size === 0 ? 0 : [...dBodies.values()].reduce((s, v) => s + v.bytes * v.n, 0),
      dedup: dedupB + gotoBytes,
      chain: chainB + gotoBytes,
      distinctBodies: dBodies.size, distinctReleases: dRelease.size,
    })
    sites += dSites
    dedupBytes += dedupB + gotoBytes
    chainBytes += chainB + gotoBytes
  }
  dBodies = new Map(); dRelease = new Map(); dTerm = new Map(); dSites = 0; dLists = []
}

const GUARD = 'if (scr_exc_pending()) {'
while (i < N) {
  let eol = text.indexOf('\n', i)
  if (eol < 0) eol = N
  const line = text.slice(i, eol)
  totalLines++
  const trimmed = line.trim()

  // top-level definition boundary
  if (line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && line[0] !== '}') {
    // a new top-level line: close the previous definition
    if (defName !== null) flushDef(defName, i)
    defName = trimmed.slice(0, 120)
  }

  if (trimmed === GUARD) {
    guardLines++; guardBytes += line.length + 1
    const indent = line.length - line.trimStart().length
    // collect the body until the matching close at the same indent
    let j = eol + 1
    const body = []
    const releases = []
    let terms = []
    let bodyByteCount = 0
    while (j < N) {
      let e2 = text.indexOf('\n', j)
      if (e2 < 0) e2 = N
      const l2 = text.slice(j, e2)
      const t2 = l2.trim()
      const ind2 = l2.length - l2.trimStart().length
      if (t2 === '}' && ind2 === indent) { guardLines++; guardBytes += l2.length + 1; j = e2 + 1; break }
      body.push(t2)
      bodyByteCount += l2.length + 1
      if (/_release\(|scr_box_release\(/.test(t2)) { releases.push(t2); dRelease.set(t2, (dRelease.get(t2) ?? 0) + t2.length + 9) }
      else terms.push(t2)
      j = e2 + 1
    }
    const key = body.join('\n')
    const prev = dBodies.get(key)
    if (prev) prev.n++
    else dBodies.set(key, { n: 1, bytes: bodyByteCount })
    for (const t of terms) dTerm.set(t, t.length + 9)
    dSites++
    dLists.push(releases)
    bodyLines += body.length
    bodyBytes += bodyByteCount
    i = j
    continue
  }
  i = eol + 1
}
if (defName !== null) flushDef(defName, N)

console.log('file    ' + path)
console.log('bytes   ' + fmt(N) + '   lines ' + fmt(totalLines))
console.log('')
console.log('pending-check sites            ' + fmt(sites))
console.log('guard lines (the if/} pair)    ' + fmt(guardLines) + '   ' + fmt(guardBytes) + ' bytes')
console.log('epilogue body lines            ' + fmt(bodyLines) + '   ' + fmt(bodyBytes) + ' bytes')
console.log('')
console.log('  model     epilogue bytes    saved vs now      % of file')
const row = (n, b) => '  ' + n.padEnd(10) + String(fmt(b)).padStart(14) +
  String(fmt(bodyBytes - b)).padStart(16) + (100 * (bodyBytes - b) / N).toFixed(2).padStart(14)
console.log(row('now', bodyBytes))
console.log(row('dedup', dedupBytes))
console.log(row('chain', chainBytes))
console.log('')
console.log('release-list nesting between consecutive sites in a function:')
console.log('  suffix-extension  ' + fmt(nestOk) + '   NOT  ' + fmt(nestBad) +
  '   (' + (100 * nestOk / Math.max(1, nestOk + nestBad)).toFixed(2) + '% nest)')
console.log('')
perDef.sort((a, b) => (b.now - b.chain) - (a.now - a.chain))
console.log('TOP ' + TOP + ' definitions by chain saving')
console.log('  saved       now      sites  bodies  rels  definition')
for (const d of perDef.slice(0, TOP)) {
  console.log('  ' + String(fmt(d.now - d.chain)).padStart(9) + String(fmt(d.now)).padStart(10) +
    String(fmt(d.sites)).padStart(8) + String(fmt(d.distinctBodies)).padStart(8) +
    String(fmt(d.distinctReleases)).padStart(6) + '  ' + d.name.slice(0, 70))
}
