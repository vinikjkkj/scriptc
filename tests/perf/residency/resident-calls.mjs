/**
 * resident-calls.mjs - WHAT THE RESIDENT CODE IS MADE OF.
 *
 *   node tests/perf/residency/resident-calls.mjs --exe <exe> --ws <wsmap.txt> \
 *        --syms <syms.json> [--top N]
 *   node tests/perf/residency/resident-calls.mjs --self-test
 *
 * tests/perf/imagesize/calls.mjs censuses the direct call sites of a whole
 * image. This runs the same census and then partitions it by whether each call
 * site's PAGE was resident during a real run, which turns a SIZE statement
 * into a MEMORY one: "scr_dyn_release is 34.6% of the image" becomes
 * "...and 30.8% of the code that was actually in RAM".
 *
 * The census rule is imagesize/calls.mjs's: an E8 (call) or E9 (jmp) rel32
 * whose computed target lands EXACTLY on a symbol start is a direct reference
 * to that symbol. Anything landing mid-symbol is dropped rather than
 * attributed to the preceding one. On zapo this recovers 83.21% of E8/E9
 * candidates, against 83.32% measured independently by block/perfsz on a
 * different build - two implementations agreeing on the same population.
 *
 * The 17% that do not land on a symbol start are overwhelmingly not calls at
 * all: 0xE8 and 0xE9 are common bytes inside immediates and displacements, and
 * a linear scan cannot tell an opcode from a payload. That is why the
 * denominator printed is the EXACT count and never the candidate count.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parsePe, parseWsmap, prepareSymbols } from './wsattrib.mjs'

const PAGE = 4096

/** The pure census. textBytes is the raw .text; startAt maps an rva that is a
 *  symbol START to its name; isResident(rva) says whether that rva's page was
 *  resident. Everything the CLI does around this is I/O. */
export function censusCalls({ textBytes, textRva, startAt, isResident }) {
  const byCallee = new Map()
  let candidates = 0
  let exact = 0
  let exactResident = 0
  const end = textBytes.length - 5
  for (let i = 0; i <= end; i++) {
    const op = textBytes[i]
    if (op !== 0xe8 && op !== 0xe9) continue
    candidates++
    const rel = textBytes.readInt32LE(i + 1)
    const siteRva = textRva + i
    const target = siteRva + 5 + rel
    const name = startAt.get(target)
    if (name === undefined) continue
    exact++
    const res = isResident(siteRva)
    if (res) exactResident++
    const a = byCallee.get(name) ?? { name, all: 0, res: 0 }
    a.all++
    if (res) a.res++
    byCallee.set(name, a)
  }
  return { candidates, exact, exactResident, byCallee }
}

export const isReleaseName = (n) => /_release$/.test(n) || /^sc_release__/.test(n)

// ------------------------------------------------------------------ self-test
function selfTest() {
  let ok = 0
  const fail = []
  const check = (name, cond) => { if (cond) ok++; else fail.push(name) }

  // A synthetic .text at rva 0x1000 with three planted calls and one 0xE8 that
  // is NOT a call (its rel32 points nowhere near a symbol). Known by
  // construction, so every count below is arithmetic rather than observation.
  const textRva = 0x1000
  const text = Buffer.alloc(0x3000, 0x90) // nops
  const plant = (off, targetRva) => {
    text[off] = 0xe8
    text.writeInt32LE(targetRva - (textRva + off + 5), off + 1)
  }
  const SYM_A = 0x2000
  const SYM_B = 0x2800
  plant(0x0000, SYM_A)   // page 0x1000  -> resident
  plant(0x0100, SYM_A)   // page 0x1000  -> resident
  plant(0x1000, SYM_B)   // page 0x2000  -> NOT resident
  plant(0x1100, 0x9999)  // page 0x2000, target is not a symbol start
  const startAt = new Map([[SYM_A, 'scr_dyn_release'], [SYM_B, 'scr_exc_pending']])
  const residentPages = new Set([0x1000])
  const isResident = (rva) => residentPages.has(rva & ~(PAGE - 1))

  const r = censusCalls({ textBytes: text, textRva, startAt, isResident })
  check('all four E8 bytes are candidates', r.candidates >= 4)
  check('exactly three land on a symbol start', r.exact === 3)
  check('exactly two of those are on a resident page', r.exactResident === 2)
  check('scr_dyn_release: 2 sites, 2 resident',
    r.byCallee.get('scr_dyn_release').all === 2 && r.byCallee.get('scr_dyn_release').res === 2)
  check('scr_exc_pending: 1 site, 0 resident',
    r.byCallee.get('scr_exc_pending').all === 1 && r.byCallee.get('scr_exc_pending').res === 0)
  check('the non-symbol target is not attributed to anyone', r.byCallee.size === 2)

  // NEGATIVE CONTROL 1: with NOTHING resident, every site must still be
  // counted and every resident count must be zero. A census that reported the
  // same numbers either way would be measuring the image, not the run.
  const none = censusCalls({ textBytes: text, textRva, startAt, isResident: () => false })
  check('nothing resident -> same exact count', none.exact === r.exact)
  check('nothing resident -> zero resident sites', none.exactResident === 0)
  check('nothing resident -> scr_dyn_release res is 0', none.byCallee.get('scr_dyn_release').res === 0)

  // NEGATIVE CONTROL 2: with EVERYTHING resident the resident count must equal
  // the exact count - the other end of the same lever.
  const all = censusCalls({ textBytes: text, textRva, startAt, isResident: () => true })
  check('everything resident -> resident equals exact', all.exactResident === all.exact)

  // NEGATIVE CONTROL 3: moving one plant off a symbol start by ONE byte must
  // lose exactly one exact hit. An off-by-one in the +5 rel32 base would pass
  // every assertion above and fail this one.
  const text2 = Buffer.from(text)
  text2.writeInt32LE(SYM_A + 1 - (textRva + 0x0000 + 5), 0x0001)
  const off1 = censusCalls({ textBytes: text2, textRva, startAt, isResident })
  check('a target one byte past a symbol start is NOT counted', off1.exact === r.exact - 1)

  check('isReleaseName accepts both spellings',
    isReleaseName('scr_dyn_release') && isReleaseName('sc_release__x25_Foo'))
  check('isReleaseName rejects a near miss',
    !isReleaseName('scr_release_pending') && !isReleaseName('scr_dyn_released_count'))

  console.log('self-test: ' + ok + ' passed, ' + fail.length + ' failed')
  for (const f of fail) console.log('  FAILED: ' + f)
  return fail.length === 0
}

// ------------------------------------------------------------------------ cli
const IS_MAIN = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  return i < 0 ? d : argv[i + 1]
}

if (IS_MAIN && argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)

if (IS_MAIN) {
  const EXE = flag('exe')
  const WS = flag('ws')
  const SYMS = flag('syms')
  const TOP = Number.parseInt(flag('top', '22'), 10)
  if (!EXE || !WS || !SYMS) {
    console.error('usage: resident-calls.mjs --exe <exe> --ws <wsmap.txt> --syms <syms.json> [--top N]')
    console.error('       resident-calls.mjs --self-test')
    process.exit(2)
  }
  const buf = readFileSync(EXE)
  const pe = parsePe(buf)
  const peOff = buf.readUInt32LE(0x3c)
  const optSize = buf.readUInt16LE(peOff + 20)
  const secOff = peOff + 24 + optSize
  let text = null
  let rawptr = 0
  for (let i = 0; i < pe.sections.length; i++) {
    const o = secOff + i * 40
    let name = ''
    for (let k = 0; k < 8; k++) { const c = buf[o + k]; if (c) name += String.fromCharCode(c) }
    if (name === '.text') { text = pe.sections[i]; rawptr = buf.readUInt32LE(o + 20) }
  }
  if (!text) throw new Error('no .text in ' + EXE)

  const sorted = prepareSymbols(JSON.parse(readFileSync(SYMS, 'utf8')))
  const startAt = new Map()
  for (const s of sorted) if (!startAt.has(s.rva)) startAt.set(s.rva, s.name)

  const { base, pages } = parseWsmap(readFileSync(WS, 'utf8'))
  const residentPages = new Set()
  for (const p of pages) {
    const rva = Number(p.va - base)
    if (rva >= 0 && rva < text.rva + text.vsize) residentPages.add(rva & ~(PAGE - 1))
  }

  const textBytes = buf.subarray(rawptr, rawptr + Math.min(text.rawsize, buf.length - rawptr))
  const r = censusCalls({
    textBytes,
    textRva: text.rva,
    startAt,
    isResident: (rva) => residentPages.has(rva & ~(PAGE - 1))
  })

  const f = (n) => Number(n).toLocaleString('en-US')
  console.log('DIRECT CALL SITES in .text, split by whether the site is on a RESIDENT page')
  console.log('  E8/E9 candidates ' + f(r.candidates) + ', landing exactly on a symbol start ' +
    f(r.exact) + ' (' + ((r.exact / r.candidates) * 100).toFixed(2) + '%)')
  console.log('  the rest are overwhelmingly not calls: 0xE8/0xE9 also occur inside immediates')
  console.log('  and displacements, so the denominator below is the EXACT count, never the candidates.')
  console.log('  on a resident page: ' + f(r.exactResident) + ' (' +
    ((r.exactResident / r.exact) * 100).toFixed(1) + '%)')
  console.log('  resident .text bytes ' + f(residentPages.size * PAGE) + ' of ' + f(text.vsize))
  console.log('')
  console.log('  ' + 'sitesAll'.padStart(11) + 'sitesRes'.padStart(11) + '  %ofRes  callee')
  const top = [...r.byCallee.values()].sort((a, b) => b.res - a.res)
  let cum = 0
  for (const a of top.slice(0, TOP)) {
    cum += a.res
    console.log('  ' + f(a.all).padStart(11) + f(a.res).padStart(11) +
      ((a.res / r.exactResident) * 100).toFixed(1).padStart(8) + '  ' + a.name)
  }
  console.log('  top ' + TOP + ' = ' + ((cum / r.exactResident) * 100).toFixed(1) + '% of resident call sites')

  let relAll = 0, relRes = 0, excAll = 0, excRes = 0
  for (const a of r.byCallee.values()) {
    if (isReleaseName(a.name)) { relAll += a.all; relRes += a.res }
    if (a.name === 'scr_exc_pending') { excAll += a.all; excRes += a.res }
  }
  console.log('')
  console.log('  releases (*_release and sc_release__*): ' + f(relAll) + ' sites, ' + f(relRes) +
    ' resident = ' + ((relRes / r.exactResident) * 100).toFixed(1) + '% of resident call sites')
  console.log('  scr_exc_pending guards:                ' + f(excAll) + ' sites, ' + f(excRes) +
    ' resident = ' + ((excRes / r.exactResident) * 100).toFixed(1) + '% of resident call sites')
  console.log('  together ' + (((relRes + excRes) / r.exactResident) * 100).toFixed(1) + '%')
}
