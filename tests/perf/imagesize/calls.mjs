/**
 * calls.mjs - count DIRECT CALLS to named functions in a shipped PE.
 *
 * Not a disassembler: it scans .text for the two-byte-free encodings
 * `E8 rel32` (call) and `E9 rel32` (tail jmp), computes
 * target = rva(next insn) + rel32, and keeps ONLY targets that land
 * EXACTLY on a symbol start taken from the PDB. That exactness is the
 * filter: a stray E8 inside an immediate or a jump table produces a
 * uniformly-random target, which hits an exact function start with
 * probability ~ (#symbols / 2^32) per candidate.
 *
 * The scan prints its own false-positive budget - candidates seen, exact
 * hits, and the hit rate - so a reader can judge it rather than trust it.
 * What it is FOR is a ratio between call sites to two runtime functions in
 * the same binary, where any residual noise is common to both.
 *
 * Usage: node calls.mjs --exe x.exe [--pdb x.pdb] [--match scr_] [--top 40]
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { peSections } from './attrib.mjs'
import { loadSymbols } from '../pdb-symbols.mjs'

function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

export function countCalls(exePath, pdbPath) {
  const pe = peSections(exePath)
  const buf = readFileSync(exePath)
  const syms = loadSymbols(pdbPath)
  const byRva = new Map()
  for (const s of syms) if (!byRva.has(s.rva)) byRva.set(s.rva, s.name)

  const text = pe.sections.find((s) => s.name === '.text')
  const base = text.rawPtr
  const rvaBase = text.rva
  const n = text.rawSize
  const hits = new Map()
  let candidates = 0, exact = 0
  for (let i = 0; i + 5 <= n; i++) {
    const op = buf[base + i]
    if (op !== 0xe8 && op !== 0xe9) continue
    candidates++
    const rel = buf.readInt32LE(base + i + 1)
    const target = rvaBase + i + 5 + rel
    const name = byRva.get(target)
    if (name === undefined) continue
    exact++
    let e = hits.get(name); if (!e) { e = { call: 0, jmp: 0 }; hits.set(name, e) }
    if (op === 0xe8) e.call++; else e.jmp++
  }
  return { pe, text, syms: syms.length, distinctRva: byRva.size, candidates, exact, hits }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
  const exe = flag('exe')
  if (!exe) { console.error('usage: --exe x.exe [--pdb x.pdb] [--match re] [--top N]'); process.exit(2) }
  const pdb = flag('pdb') ?? exe.replace(/\.exe$/i, '.pdb')
  const match = new RegExp(flag('match', '.'))
  const top = Number(flag('top', '40'))
  const r = countCalls(exe, pdb)
  console.log('exe            ' + exe)
  console.log('.text          rawsize ' + fmt(r.text.rawSize) + '  vsize ' + fmt(r.text.vsize) + '  rva ' + r.text.rva)
  console.log('pdb symbols    ' + fmt(r.syms) + '  distinct rvas ' + fmt(r.distinctRva))
  console.log('E8/E9 bytes    ' + fmt(r.candidates) + '   landing exactly on a symbol start ' + fmt(r.exact) +
    '  (' + (100 * r.exact / r.candidates).toFixed(2) + '%)')
  console.log('random-hit expectation per candidate ~ ' + (r.distinctRva / 2 ** 32).toExponential(2) +
    '  -> expected false positives ~ ' + (r.candidates * r.distinctRva / 2 ** 32).toFixed(1))
  console.log('')
  if (argv.includes('--family')) {
    /* The families that matter for SIZE: the emitted program is a sequence
     * of calls into the runtime, so `.text bytes / call site` is the rate at
     * which any reduction in call sites pays. */
    const fam = new Map()
    let all = 0
    for (const [k, v] of r.hits) {
      const n = v.call + v.jmp
      all += n
      let f = 'other'
      if (/release/.test(k)) f = 'refcount release'
      else if (/retain/.test(k)) f = 'refcount retain'
      else if (/^scr_exc_pending$/.test(k)) f = 'exception guard'
      else if (/^scr_dyn_|^sc_dyn_/.test(k)) f = 'dyn operation'
      else if (/^scr_/.test(k)) f = 'runtime, other'
      else if (/^sc_/.test(k)) f = 'program-internal'
      fam.set(f, (fam.get(f) ?? 0) + n)
    }
    console.log('  family                    call sites        %      .text bytes each')
    const textv = r.text.vsize
    for (const [k, v] of [...fam].sort((a, b) => b[1] - a[1])) {
      console.log('  ' + k.padEnd(22) + fmt(v).padStart(13) + (100 * v / all).toFixed(2).padStart(9) + '%')
    }
    console.log('  ' + 'TOTAL'.padEnd(22) + fmt(all).padStart(13))
    console.log('  .text vsize ' + fmt(textv) + '  /  ' + fmt(all) + ' call sites = ' +
      (textv / all).toFixed(2) + ' bytes of .text per call site')
    process.exit(0)
  }
  const rows = [...r.hits].filter(([k]) => match.test(k)).sort((a, b) => (b[1].call + b[1].jmp) - (a[1].call + a[1].jmp))
  let sum = 0
  for (const [, v] of rows) sum += v.call + v.jmp
  console.log('  target                                        call        jmp      total')
  for (const [k, v] of rows.slice(0, top)) {
    console.log('  ' + k.padEnd(44) + fmt(v.call).padStart(10) + fmt(v.jmp).padStart(11) + fmt(v.call + v.jmp).padStart(11))
  }
  console.log('  ' + 'MATCHED TOTAL'.padEnd(44) + ''.padStart(21) + fmt(sum).padStart(11) + '   over ' + rows.length + ' targets')
}
