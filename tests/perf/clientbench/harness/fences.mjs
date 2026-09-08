/* fences.mjs — count [SCxxxx] refusal fences left in an emitted artifact.
 *
 *   node fences.mjs <dir-or-file> [...]
 *
 * Scans EVERY emitted file, not just the program .c: .c, .h, .scrh, .ll and
 * the linked .exe bytes. A fence count that reads zero because it looked at
 * one file, or at a stale directory whose C was never regenerated, has been
 * this fleet's most repeated false green — so this prints, per extension,
 * how many files it actually opened. Zero files scanned prints "n/a", never 0.
 *
 * Two independent counters, because they answer different questions:
 *   TEXT   — occurrences of an SC code in the emitted C/IR text. This is
 *            what "no [SCxxxx] throws left in the emitted C" asks about.
 *   BINARY — occurrences in the linked executable's bytes. Note that a
 *            string can survive into .rdata without any reachable code
 *            path throwing it, and destructors never run in these PE
 *            binaries, so a byte hit is evidence to explain, not a verdict.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const TEXT_EXT = new Set(['.c', '.h', '.scrh', '.ll', '.cpp'])
const BIN_EXT = new Set(['.exe', '.dll', '.o', '.obj', '.a'])
const RE = /SC\d{4}/g

function walk(p, out) {
  const st = statSync(p)
  if (st.isDirectory()) {
    for (const n of readdirSync(p)) walk(join(p, n), out)
  } else out.push(p)
}

const roots = process.argv.slice(2)
if (roots.length === 0) {
  console.error('usage: fences.mjs <dir-or-file> [...]')
  process.exit(2)
}
const files = []
for (const r of roots) walk(r, files)

const perExt = new Map()
const textHits = new Map()
let textFiles = 0
let binFiles = 0
const binHits = new Map()

for (const f of files) {
  const e = extname(f).toLowerCase()
  perExt.set(e, (perExt.get(e) ?? 0) + 1)
  if (TEXT_EXT.has(e)) {
    textFiles++
    const s = readFileSync(f, 'latin1')
    for (const m of s.matchAll(RE)) {
      const k = m[0]
      textHits.set(k, (textHits.get(k) ?? 0) + 1)
    }
  } else if (BIN_EXT.has(e)) {
    binFiles++
    const s = readFileSync(f, 'latin1')
    for (const m of s.matchAll(RE)) {
      const k = m[0]
      binHits.set(k, (binHits.get(k) ?? 0) + 1)
    }
  }
}

const total = (m) => [...m.values()].reduce((a, b) => a + b, 0)
const show = (label, n, m) => {
  if (n === 0) {
    console.log(`${label}: n/a (0 files of that kind were present — nothing to count)`)
    return
  }
  console.log(`${label}: ${total(m)} occurrence(s) over ${n} file(s)`)
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}  x${v}`)
  }
}

console.log('files seen by extension: ' + [...perExt.entries()].map(([e, n]) => `${e || '<none>'}=${n}`).join(' '))
show('TEXT fences (.c/.h/.scrh/.ll)', textFiles, textHits)
show('BINARY fences (.exe/.o/.a)', binFiles, binHits)
