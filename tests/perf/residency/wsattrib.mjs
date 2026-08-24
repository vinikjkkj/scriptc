/**
 * wsattrib.mjs - PEAK RSS BY PE SECTION AND BY FUNCTION.
 *
 *   node tests/perf/residency/wsattrib.mjs --ws <wsmap.txt> --syms <syms.json> \
 *        --exe <program.exe> [--top N]
 *   node tests/perf/residency/wsattrib.mjs --self-test
 *
 * Joins the resident-page union written by wsmap.ps1 onto the PDB symbol table
 * written by tests/perf/pdb-symbols.mjs. It is the other half of the memory
 * map: scr_prof.h's --alloc/--live lanes attribute the HEAP, and cannot see a
 * byte of the program's own image because no malloc is involved. Measured on
 * zapo's fake-server run, the image half is 41.2% of the working set, so a map
 * without it is missing more than it contains.
 *
 * HOW A PAGE IS CHARGED. A page is 4096 bytes and a function is not, so the
 * join is many-to-many. The page is charged WHOLE to the symbol that owns its
 * first byte. Charging it to every symbol on it would multiply-count and the
 * column would not sum to the resident total; charging it pro-rata would
 * invent a resolution the kernel does not have. So the column sums exactly,
 * and the price is that a large function's neighbours can look resident when
 * only it ran. That price is highest in .rdata and .data, where PDB symbols
 * are sparse - the report labels those two sections COARSE for that reason.
 *
 * WHAT A RESIDENT PAGE MEANS PER SECTION, because conflating them hides which
 * lever moves which:
 *   .text    code that was executed, or that shares a page with code that was
 *   .rdata   a constant that was read
 *   .data    a mutable global that was read or written (a written one is also
 *            PRIVATE, i.e. it is a copy, not a share)
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PAGE = 4096

// ---------------------------------------------------------------- pure parts
/** Sections a PE lists, read straight from the file. */
export function parsePe(bytes) {
  const b = bytes
  const peOff = b.readUInt32LE(0x3c)
  const nSec = b.readUInt16LE(peOff + 6)
  const optSize = b.readUInt16LE(peOff + 20)
  const optOff = peOff + 24
  const secOff = optOff + optSize
  const sections = []
  for (let i = 0; i < nSec; i++) {
    const o = secOff + i * 40
    let name = ''
    for (let k = 0; k < 8; k++) {
      const c = b[o + k]
      if (c) name += String.fromCharCode(c)
    }
    sections.push({
      name,
      vsize: b.readUInt32LE(o + 8),
      rva: b.readUInt32LE(o + 12),
      rawsize: b.readUInt32LE(o + 16)
    })
  }
  return { sections, fileSize: b.length }
}

export function sectionOf(sections, rva) {
  for (const s of sections) {
    if (rva >= s.rva && rva < s.rva + Math.max(s.vsize, s.rawsize)) return s.name
  }
  return '<none>'
}

/** Symbols sorted by rva, each extended to the next one's start. The PDB dump
 *  carries size 0, which is why the extent has to be inferred - the same
 *  convention pdb-symbols.mjs's resolver uses, and the same reason a row there
 *  can be marked INEXACT. */
export function prepareSymbols(syms) {
  const s = [...syms].sort((a, b) => a.rva - b.rva)
  for (let i = 0; i < s.length; i++) s[i].end = i + 1 < s.length ? s[i + 1].rva : Infinity
  return s
}

export function symbolAt(sorted, rva) {
  let lo = 0
  let hi = sorted.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].rva <= rva) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return best < 0 ? null : sorted[best]
}

/** The whole attribution, as a function of data, so it can be self-tested
 *  without a process, a PDB or a PE on disk. */
export function attribute({ pages, base, sections, symbols }) {
  const sorted = prepareSymbols(symbols)
  const imageEnd = base + BigInt(sections.reduce((a, s) => Math.max(a, s.rva + Math.max(s.vsize, s.rawsize)), 0))
  const inImage = pages.filter((p) => p.va >= base && p.va < imageEnd)
  const bySec = new Map()
  const bySym = new Map()
  for (const p of inImage) {
    const rva = Number(p.va - base)
    const sec = sectionOf(sections, rva)
    bySec.set(sec, (bySec.get(sec) ?? 0) + PAGE)
    const s = symbolAt(sorted, rva)
    const key = s ? s.name : '<' + sec + ' unsymbolised>'
    const a = bySym.get(key) ?? { name: key, bytes: 0, pages: 0, sec }
    a.bytes += PAGE
    a.pages += 1
    bySym.set(key, a)
  }
  return {
    totalPages: pages.length,
    inImagePages: inImage.length,
    outImagePages: pages.length - inImage.length,
    bySection: bySec,
    bySymbol: bySym
  }
}

export function parseWsmap(text) {
  let base = 0n
  const pages = []
  for (const l of text.split(/\r?\n/)) {
    if (l.startsWith('WSMAP ')) {
      const m = /base=(\d+)/.exec(l)
      if (m) base = BigInt(m[1])
    } else if (l.startsWith('P ')) {
      const p = l.split(' ')
      pages.push({ va: BigInt(p[1]), shared: p[2] === '1' })
    }
  }
  return { base, pages }
}

// ------------------------------------------------------------------ self-test
// Every assertion is known BY CONSTRUCTION, and two of them are negative
// controls: a harness that cannot report "changed" cannot be trusted when it
// reports a number.
function selfTest() {
  let ok = 0
  const fail = []
  const check = (name, cond) => {
    if (cond) ok++
    else fail.push(name)
  }

  const base = 0x140000000n
  const sections = [
    { name: '.text', rva: 0x1000, vsize: 0x4000, rawsize: 0x4000 },
    { name: '.rdata', rva: 0x5000, vsize: 0x2000, rawsize: 0x2000 }
  ]
  const symbols = [
    { rva: 0x1000, name: 'alpha' },
    { rva: 0x3000, name: 'beta' },
    { rva: 0x5000, name: 'konst' }
  ]
  // pages: two in .text (one in alpha, one in beta), one in .rdata, one far
  // outside the image entirely.
  const mk = (off) => ({ va: base + BigInt(off), shared: false })
  const pages = [mk(0x1000), mk(0x3000), mk(0x5000), { va: 0x7ff000000000n, shared: true }]

  const r = attribute({ pages, base, sections, symbols })
  check('4 pages in, 3 inside the image', r.totalPages === 4 && r.inImagePages === 3)
  check('1 page outside the image', r.outImagePages === 1)
  check('.text charged 2 pages', r.bySection.get('.text') === 2 * PAGE)
  check('.rdata charged 1 page', r.bySection.get('.rdata') === PAGE)
  check('sections sum to the in-image bytes',
    [...r.bySection.values()].reduce((a, b) => a + b, 0) === r.inImagePages * PAGE)
  check('symbols sum to the in-image bytes',
    [...r.bySymbol.values()].reduce((a, b) => a + b.bytes, 0) === r.inImagePages * PAGE)
  check('alpha owns exactly its page', r.bySymbol.get('alpha').bytes === PAGE)
  check('beta owns exactly its page', r.bySymbol.get('beta').bytes === PAGE)
  check('konst is in .rdata', r.bySymbol.get('konst').sec === '.rdata')

  // NEGATIVE CONTROL 1: a page that is NOT there must not be reported. If the
  // aggregate were built from the symbol table rather than the page list, this
  // would silently pass with a zero row.
  check('an untouched symbol is absent, not zero', !r.bySymbol.has('nothing-here'))

  // NEGATIVE CONTROL 2: adding ONE page must change the answer by exactly one
  // page, in the right section and the right symbol.
  const r2 = attribute({ pages: [...pages, mk(0x3800)], base, sections, symbols })
  check('one extra page moves .text by exactly 4096',
    r2.bySection.get('.text') - r.bySection.get('.text') === PAGE)
  check('the extra page lands on beta, not alpha',
    r2.bySymbol.get('beta').bytes - r.bySymbol.get('beta').bytes === PAGE &&
    r2.bySymbol.get('alpha').bytes === r.bySymbol.get('alpha').bytes)

  // NEGATIVE CONTROL 3: a page inside the image but BELOW every section - the
  // PE header page - must be counted as in-image, must land in <none>, and
  // must NOT be handed the first symbol's name. Getting this wrong is how an
  // attribution quietly gives the lowest-addressed function everything that
  // precedes it. This assertion is here because the first version of the test
  // asserted the WRONG behaviour (that the page is outside the image) and the
  // code was right: the real zapo run shows exactly one such page.
  const under = attribute({ pages: [{ va: base + 0x800n, shared: false }], base, sections, symbols })
  check('the pre-section page is inside the image', under.inImagePages === 1)
  check('the pre-section page lands in <none>', under.bySection.get('<none>') === PAGE)
  check('the pre-section page is NOT given the first symbol',
    !under.bySymbol.has('alpha') && under.bySymbol.has('<<none> unsymbolised>'))

  // symbolAt against a linear scan, on every boundary and between them.
  const sorted = prepareSymbols(symbols)
  const linear = (rva) => {
    let best = null
    for (const s of sorted) if (s.rva <= rva && (!best || s.rva > best.rva)) best = s
    return best
  }
  let agree = true
  for (let rva = 0; rva < 0x8000; rva += 0x137) {
    const a = symbolAt(sorted, rva)
    const b = linear(rva)
    if ((a && a.name) !== (b && b.name)) agree = false
  }
  check('binary search agrees with a linear scan everywhere', agree)

  // parseWsmap round trip.
  const parsed = parseWsmap('WSMAP base=5368709120 pages=2 shared=1 samples=3\nP 5368709120 1\nP 5368713216 0\n')
  check('parseWsmap reads the base', parsed.base === 5368709120n)
  check('parseWsmap reads both pages and the shared bit',
    parsed.pages.length === 2 && parsed.pages[0].shared === true && parsed.pages[1].shared === false)

  console.log('self-test: ' + ok + ' passed, ' + fail.length + ' failed')
  for (const f of fail) console.log('  FAILED: ' + f)
  return fail.length === 0
}

// ------------------------------------------------------------------------ cli
// Guarded, so the pure parts above can be imported by another script - which
// is how the by-symbol-family rollup in estado-ramcpu.md was produced - without
// the CLI running and exiting 2 on the importer's argv.
const IS_MAIN = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  return i < 0 ? d : argv[i + 1]
}

if (IS_MAIN && argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1)
}

if (!IS_MAIN) {
  // imported as a library; nothing below runs
} else {
const WS = flag('ws')
const SYMS = flag('syms')
const EXE = flag('exe')
const TOP = Number.parseInt(flag('top', '30'), 10)
if (!WS || !SYMS || !EXE) {
  console.error('usage: wsattrib.mjs --ws <wsmap.txt> --syms <syms.json> --exe <exe> [--top N]')
  console.error('       wsattrib.mjs --self-test')
  process.exit(2)
}

const pe = parsePe(readFileSync(EXE))
const { base, pages } = parseWsmap(readFileSync(WS, 'utf8'))
if (base === 0n) throw new Error('no image base recorded in ' + WS)
const symbols = JSON.parse(readFileSync(SYMS, 'utf8'))
const r = attribute({ pages, base, sections: pe.sections, symbols })

const fmt = (n) => Number(n).toLocaleString('en-US')
const residentImage = r.inImagePages * PAGE
const residentAll = r.totalPages * PAGE
console.log('RESIDENT-PAGE ATTRIBUTION  ' + EXE)
console.log('  exe file ' + fmt(pe.fileSize) + ' B   image base 0x' + base.toString(16))
console.log('  UNION of resident pages over the run: ' + fmt(r.totalPages) + ' = ' + fmt(residentAll) + ' B')
console.log('  (a FLOOR for the peak - a page resident only between two samples is missed - and')
console.log('   simultaneously above any single instant, because Windows trims working sets.')
console.log('   Cross-check it against the kernel PeakWorkingSetSize for the same run.)')
console.log('  inside the exe   ' + fmt(r.inImagePages) + ' pages = ' + fmt(residentImage) + ' B (' +
  ((residentImage / residentAll) * 100).toFixed(1) + '% of the working set)')
console.log('  outside the exe  ' + fmt(r.outImagePages) + ' pages = ' + fmt(r.outImagePages * PAGE) +
  ' B  (heap, thread stacks, system DLLs)')
console.log('  ' + ((residentImage / pe.fileSize) * 100).toFixed(1) + '% of the binary was faulted in')
console.log('')
console.log('  by PE section. A page is charged to the section owning its FIRST byte, so a')
console.log('  section smaller than a page can read above 100%:')
for (const [sec, bytes] of [...r.bySection.entries()].sort((a, b) => b[1] - a[1])) {
  const s = pe.sections.find((x) => x.name === sec)
  const vs = s ? Math.max(s.vsize, s.rawsize) : 0
  console.log('    ' + sec.padEnd(10) + fmt(bytes).padStart(13) + ' B resident of ' + fmt(vs).padStart(13) +
    ' B = ' + (vs ? ((bytes / vs) * 100).toFixed(1) : '-').padStart(5) + '%')
}
console.log('')
console.log('  top ' + TOP + ' symbols by RESIDENT BYTES. A page is charged whole to the symbol owning')
console.log('  its first byte, so the column sums exactly and a neighbour can ride along. COARSE in')
console.log('  .rdata and .data, where PDB symbols are sparse.')
console.log('  ' + 'bytes'.padStart(12) + 'pages'.padStart(8) + '  section  symbol')
const top = [...r.bySymbol.values()].sort((a, b) => b.bytes - a.bytes)
let cum = 0
for (const a of top.slice(0, TOP)) {
  cum += a.bytes
  console.log('  ' + fmt(a.bytes).padStart(12) + fmt(a.pages).padStart(8) + '  ' + a.sec.padEnd(8) + ' ' + a.name)
}
console.log('  top ' + Math.min(TOP, top.length) + ' = ' + ((cum / residentImage) * 100).toFixed(1) +
  '% of resident image bytes; ' + fmt(top.length) + ' symbols own at least one resident page')
}
