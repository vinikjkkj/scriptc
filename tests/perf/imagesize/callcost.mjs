/**
 * callcost.mjs - what ONE call site actually COSTS, in bytes, and WHERE in
 * its function it sits.
 *
 * calls.mjs counts direct call sites. Every ranking built on that count so
 * far has turned the count into bytes by multiplying by 21.03 - `.text`
 * divided by the number of direct call sites - which charges every byte of
 * arithmetic, loads, branches, spills and constants in the image to the call
 * sites and so over-states any call-site population by about 2.5x.
 *
 * This measures the cost instead of assuming it. For every direct `E8` whose
 * target is exactly one of the named symbols, it decodes the bytes
 * IMMEDIATELY BEFORE the call and matches them against the x86-64
 * Windows-ABI first-argument setups the backend emits. The site's cost is
 * that instruction's length plus the 5 bytes of `E8 rel32`. Sites whose
 * predecessor is not one of the recognised forms are counted and reported
 * but never averaged in, so the number printed is a measurement over the
 * sites it could decode and the print says how many that was.
 *
 * On zapo (26.9 MB, `--backend c`, -O2) it reads 8.51 B per
 * `scr_dyn_release` site over 99.2% of them - so the 442,323 sites are
 * 16.1% of `.text`, not the 39.7% that 21.03 would have claimed.
 *
 * It also reports where each site sits as a fraction of its owning symbol's
 * extent. That is the question a RESIDENCY win asks: cold code sunk to a
 * function's tail can be relocated out of the hot pages, cold code threaded
 * through the body cannot. On zapo the release sites are spread nearly
 * uniformly (6.9% in the first tenth, 16.1% in the last), because most
 * releases are on the normal path rather than in an unwind ladder.
 *
 * Usage: node callcost.mjs --exe x.exe --syms syms.json --callee NAME [--callee NAME...]
 *        node callcost.mjs --self-test
 *
 * `syms.json` is tests/perf/pdb-symbols.mjs's output. Nothing here is run by
 * the directory gate; it is a hand-run instrument, and `--self-test` is what
 * stands in for a test file.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * The forms clang uses to put the first argument in RCX before a call,
 * LONGEST FIRST so a longer encoding is never mis-read as a shorter one that
 * happens to end the same way. Each entry is [length, name, test(buf, at)].
 */
export const ARG_FORMS = [
  [8, 'mov rcx,[rsp+disp32]', (b, a) => b[a] === 0x48 && b[a + 1] === 0x8b && b[a + 2] === 0x8c && b[a + 3] === 0x24],
  [7, 'mov rcx,[rbp+disp32]', (b, a) => b[a] === 0x48 && b[a + 1] === 0x8b && b[a + 2] === 0x8d],
  [7, 'mov rcx,[rip+disp32]', (b, a) => b[a] === 0x48 && b[a + 1] === 0x8b && b[a + 2] === 0x0d],
  [7, 'lea rcx,[rip+disp32]', (b, a) => b[a] === 0x48 && b[a + 1] === 0x8d && b[a + 2] === 0x0d],
  [5, 'mov rcx,[rsp+disp8]', (b, a) => b[a] === 0x48 && b[a + 1] === 0x8b && b[a + 2] === 0x4c && b[a + 3] === 0x24],
  [4, 'mov rcx,[rbp+disp8]', (b, a) => b[a] === 0x48 && b[a + 1] === 0x8b && b[a + 2] === 0x4d],
  [4, 'mov rcx,[reg+disp8]', (b, a) => b[a] === 0x48 && b[a + 1] === 0x8b && (b[a + 2] & 0xf8) === 0x48 && b[a + 2] !== 0x4c],
  [3, 'mov rcx,r/m64', (b, a) => (b[a] === 0x48 || b[a] === 0x4c) && b[a + 1] === 0x89 && (b[a + 2] & 0xc7) === 0xc1],
  [3, 'mov rcx,[reg]', (b, a) => b[a] === 0x48 && b[a + 1] === 0x8b && (b[a + 2] & 0xf8) === 0x08],
  [3, 'mov rcx,reg (8B)', (b, a) => b[a] === 0x48 && b[a + 1] === 0x8b && (b[a + 2] & 0xf8) === 0xc8],
  [2, 'xor ecx,ecx', (b, a) => b[a] === 0x31 && b[a + 1] === 0xc9],
]

/** The argument-setup instruction immediately before the call at `callAt`. */
export function argSetupBefore(buf, callAt) {
  for (const [len, name, test] of ARG_FORMS) {
    const at = callAt - len
    if (at < 0) continue
    if (test(buf, at)) return { len, name }
  }
  return null
}

/** The symbol owning `rva`, from a list sorted by rva and carrying `end`. */
export function symbolAtRva(sorted, rva) {
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
  return best >= 0 ? sorted[best] : null
}

/**
 * The pure census. `symbols` is sorted by rva with `end` filled in; `wanted`
 * is the Set of callee names. Returns the byte tally, the setup-form
 * histogram, and the position-in-owner histogram.
 */
export function census({ textBytes, textRva, symbols, wanted }) {
  const startAt = new Map()
  for (const s of symbols) startAt.set(s.rva, s.name)
  const forms = new Map()
  const buckets = new Array(10).fill(0)
  let sites = 0
  let decoded = 0
  let bytes = 0
  let unowned = 0
  const end = textBytes.length - 5
  for (let i = 0; i <= end; i++) {
    if (textBytes[i] !== 0xe8) continue
    const target = (textRva + i + 5 + textBytes.readInt32LE(i + 1)) >>> 0
    const nm = startAt.get(target)
    if (nm === undefined || !wanted.has(nm)) continue
    sites++
    const su = argSetupBefore(textBytes, i)
    if (su) {
      decoded++
      bytes += su.len + 5
      forms.set(su.name, (forms.get(su.name) ?? 0) + 1)
    } else forms.set('<undecoded>', (forms.get('<undecoded>') ?? 0) + 1)
    const siteRva = textRva + i
    const own = symbolAtRva(symbols, siteRva)
    if (!own || !(own.end > own.rva) || own.end === Infinity) {
      unowned++
      continue
    }
    const frac = (siteRva - own.rva) / (own.end - own.rva)
    buckets[Math.min(9, Math.max(0, Math.floor(frac * 10)))]++
  }
  return { sites, decoded, bytes, unowned, forms, buckets }
}

export function parsePeSections(b) {
  const peOff = b.readUInt32LE(0x3c)
  const nSec = b.readUInt16LE(peOff + 6)
  const optSize = b.readUInt16LE(peOff + 20)
  const secOff = peOff + 24 + optSize
  const out = []
  for (let i = 0; i < nSec; i++) {
    const o = secOff + i * 40
    let name = ''
    for (let k = 0; k < 8; k++) {
      const c = b[o + k]
      if (c) name += String.fromCharCode(c)
    }
    out.push({
      name,
      vsize: b.readUInt32LE(o + 8),
      rva: b.readUInt32LE(o + 12),
      rawSize: b.readUInt32LE(o + 16),
      rawPtr: b.readUInt32LE(o + 20),
    })
  }
  return out
}

const IS_MAIN = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
const argv = process.argv.slice(2)

if (IS_MAIN && argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1)

if (IS_MAIN) {
  const exe = argv[argv.indexOf('--exe') + 1]
  const symsFile = argv[argv.indexOf('--syms') + 1]
  const wanted = new Set()
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--callee') wanted.add(argv[i + 1])
  if (!argv.includes('--exe') || !argv.includes('--syms') || wanted.size === 0) {
    console.error('usage: callcost.mjs --exe x.exe --syms syms.json --callee NAME [--callee NAME...]')
    console.error('       callcost.mjs --self-test')
    process.exit(2)
  }
  const bytes = readFileSync(exe)
  const text = parsePeSections(bytes).find((s) => s.name === '.text')
  const textBytes = bytes.subarray(text.rawPtr, text.rawPtr + Math.min(text.rawSize, text.vsize))
  const raw = JSON.parse(readFileSync(symsFile, 'utf8'))
  const list = Array.isArray(raw) ? raw : (raw.symbols ?? raw.syms)
  const symbols = [...list].sort((a, b) => a.rva - b.rva)
  for (let i = 0; i < symbols.length; i++) {
    symbols[i].end = i + 1 < symbols.length ? symbols[i + 1].rva : text.rva + text.vsize
  }

  const r = census({ textBytes, textRva: text.rva, symbols, wanted })
  const per = r.bytes / (r.decoded || 1)
  console.log(`exe             ${exe}`)
  console.log(`.text           ${text.vsize.toLocaleString()} bytes`)
  console.log(`callees         ${[...wanted].join(', ')}`)
  console.log(`E8 sites        ${r.sites.toLocaleString()}`)
  console.log(`decoded         ${r.decoded.toLocaleString()} (${((100 * r.decoded) / (r.sites || 1)).toFixed(1)}%)`)
  console.log(`bytes measured  ${r.bytes.toLocaleString()}  =  ${per.toFixed(2)} B per decoded site`)
  console.log(
    `extrapolated    ${Math.round(per * r.sites).toLocaleString()} B over all ${r.sites.toLocaleString()} sites = ${((100 * per * r.sites) / text.vsize).toFixed(1)}% of .text`,
  )
  console.log(`\nargument setup immediately before the call:`)
  for (const [k, v] of [...r.forms].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(9)}  ${((100 * v) / (r.sites || 1)).toFixed(1).padStart(5)}%  ${k}`)
  }
  console.log(`\nposition of each site inside its owning symbol (unowned ${r.unowned}):`)
  let acc = 0
  for (let i = 0; i < 10; i++) {
    acc += r.buckets[i]
    const pct = r.sites ? (100 * r.buckets[i]) / r.sites : 0
    console.log(
      `  [${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)})  ${String(r.buckets[i]).padStart(8)}  ${pct.toFixed(1).padStart(5)}%  cum ${((100 * acc) / (r.sites || 1)).toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(pct / 2))}`,
    )
  }
}

function selfTest() {
  let bad = 0
  const ok = (got, want, what) => {
    const g = JSON.stringify(got)
    const w = JSON.stringify(want)
    if (g !== w) {
      console.log(`FAIL ${what}: got ${g} want ${w}`)
      bad++
    } else console.log(`ok   ${what}`)
  }
  const mk = (...b) => Buffer.from(b)
  ok(argSetupBefore(mk(0x48, 0x8b, 0x4d, 0xf8, 0xe8), 4)?.len, 4, 'mov rcx,[rbp+disp8] is 4 bytes')
  ok(argSetupBefore(mk(0x48, 0x8b, 0x8d, 0, 0xff, 0xff, 0xff, 0xe8), 7)?.len, 7, 'mov rcx,[rbp+disp32] is 7 bytes')
  ok(argSetupBefore(mk(0x48, 0x8b, 0x4c, 0x24, 0x30, 0xe8), 5)?.len, 5, 'mov rcx,[rsp+disp8] is 5 bytes')
  ok(argSetupBefore(mk(0x48, 0x89, 0xd9, 0xe8), 3)?.name, 'mov rcx,r/m64', 'mov rcx,reg is 3 bytes')
  ok(argSetupBefore(mk(0x4c, 0x89, 0xe1, 0xe8), 3)?.len, 3, 'REX.R mov rcx,reg is 3 bytes')
  ok(argSetupBefore(mk(0x31, 0xc9, 0xe8), 2)?.len, 2, 'xor ecx,ecx is 2 bytes')
  ok(argSetupBefore(mk(0x48, 0x8d, 0x0d, 1, 2, 3, 4, 0xe8), 7)?.len, 7, 'lea rcx,[rip] is 7 bytes')
  ok(argSetupBefore(mk(0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0xe8), 8), null, 'an unrecognised predecessor is not decoded')
  ok(argSetupBefore(mk(0x48, 0x8b, 0x8c, 0x24, 0x10, 0x20, 0x30, 0x40, 0xe8), 8)?.len, 8, 'a disp32 form wins over a shorter suffix')
  ok(argSetupBefore(mk(0xe8), 0), null, 'no room before the call')

  const sorted = [
    { name: 'a', rva: 0x1000, end: 0x1100 },
    { name: 'b', rva: 0x1100, end: 0x1200 },
  ]
  ok(symbolAtRva(sorted, 0x1000).name, 'a', 'symbol at its own start')
  ok(symbolAtRva(sorted, 0x10ff).name, 'a', 'symbol at its last byte')
  ok(symbolAtRva(sorted, 0x1100).name, 'b', "the next symbol's start")
  ok(symbolAtRva(sorted, 0x0fff), null, 'below every symbol')

  // one `mov rcx,[rbp-8]; call rel_fn` at 0x1020, inside `a` (0x1000..0x1100)
  const text = Buffer.alloc(0x200, 0x90)
  const textRva = 0x1000
  text[0x1c] = 0x48
  text[0x1d] = 0x8b
  text[0x1e] = 0x4d
  text[0x1f] = 0xf8
  text[0x20] = 0xe8
  text.writeInt32LE(0x1200 - (textRva + 0x20 + 5), 0x21)
  const symbols = [
    { name: 'a', rva: 0x1000, end: 0x1100 },
    { name: 'b', rva: 0x1100, end: 0x1200 },
    { name: 'rel_fn', rva: 0x1200, end: 0x1300 },
  ]
  const r = census({ textBytes: text, textRva, symbols, wanted: new Set(['rel_fn']) })
  ok(r.sites, 1, 'one site found')
  ok(r.decoded, 1, 'its argument setup decoded')
  ok(r.bytes, 9, 'the site costs 4 + 5 bytes')
  ok(r.buckets[1], 1, 'a site 0x20 into a 0x100 symbol lands in [0.1-0.2)')
  ok(r.buckets.reduce((x, y) => x + y, 0), 1, 'no other bucket moved')
  ok(census({ textBytes: text, textRva, symbols, wanted: new Set(['nope']) }).sites, 0, 'an unnamed callee is not counted')
  const t2 = Buffer.alloc(0x200, 0x90)
  t2[0x20] = 0xe8
  t2.writeInt32LE(0x1208 - (textRva + 0x20 + 5), 0x21)
  ok(census({ textBytes: t2, textRva, symbols, wanted: new Set(['rel_fn']) }).sites, 0, 'a mid-symbol target is dropped')
  const t3 = Buffer.alloc(0x200, 0x90)
  t3[0x20] = 0xe8
  t3.writeInt32LE(0x1200 - (textRva + 0x20 + 5), 0x21)
  const r3 = census({ textBytes: t3, textRva, symbols, wanted: new Set(['rel_fn']) })
  ok([r3.sites, r3.decoded, r3.bytes], [1, 0, 0], 'an undecoded site is counted but never averaged in')

  console.log(bad === 0 ? '\nself-test: 21 passed, 0 failed' : `\nself-test: ${bad} failed`)
  return bad === 0
}
