/* The full-scale version of the corpus sweep, on zapo-rest/app182.
 *
 * The IR dumps are ~479 MB each, so neither is parsed whole: serializeModule
 * pretty-prints with a 2-space indent, which puts every element of the
 * top-level "functions" array at indent 4 — one `    {` ... `    }` block per
 * function. The reader slices on those boundaries and parses one function at
 * a time, so peak memory is one function, not one program.
 *
 * Each function is reduced to (owning file, canonical form), where the
 * canonical form strips source locations and folds every POSITIONAL id to its
 * family — the ids an assembler re-mints. Functions whose owning file is the
 * entry are dropped: entry-owned work is not what a per-library cache claims.
 * The two arms' remaining multisets are then compared.
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const canon = (s) => s
  .replace(/"r\d+"/g, '"r#"')
  .replace(/"u\d+"/g, '"u#"')
  .replace(/%fn\d+/g, '%fn#')
  .replace(/%([A-Za-z][A-Za-z0-9.]*)\.\d+/g, '%$1.#')
  .replace(/%(\d+)\b/g, '%#')

const stripLocs = (n) => {
  if (n === null || typeof n !== 'object') return n
  if (Array.isArray(n)) return n.map(stripLocs)
  const o = {}
  for (const [k, v] of Object.entries(n)) { if (k !== 'loc') o[k] = stripLocs(v) }
  return o
}
const fileOf = (fn) => {
  let found = null
  const walk = (n) => {
    if (found !== null || n === null || typeof n !== 'object') return
    if (Array.isArray(n)) { for (const x of n) walk(x); return }
    if (typeof n.file === 'string' && typeof n.start === 'number') { found = n.file; return }
    for (const v of Object.values(n)) walk(v)
  }
  walk(fn); return found
}

async function digest(path, entryNames) {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  let inFns = false, buf = null
  const counts = new Map()      // canonical form -> count   (non-entry only)
  const names = new Map()       // canonical form -> a sample name
  let total = 0, entryOwned = 0, unattributed = 0
  for await (const line of rl) {
    if (!inFns) { if (line === '  "functions": [') inFns = true; continue }
    if (line === '  ],' || line === '  ]') break
    if (line === '    {') { buf = ['{']; continue }
    if (buf === null) continue
    if (line === '    },' || line === '    }') {
      buf.push('}')
      const fn = JSON.parse(buf.join('\n'))
      buf = null
      total++
      const f = fileOf(fn)
      if (f === null) { unattributed++; continue }
      if (entryNames.has(f)) { entryOwned++; continue }
      const c = canon(JSON.stringify(stripLocs(fn)))
      counts.set(c, (counts.get(c) ?? 0) + 1)
      if (!names.has(c)) names.set(c, fn.name)
      continue
    }
    buf.push(line.slice(4))
  }
  return { counts, names, total, entryOwned, unattributed }
}

const [aPath, bPath, aEntry, bEntry] = process.argv.slice(2)
const entries = new Set([aEntry, bEntry])
const A = await digest(aPath, entries)
const B = await digest(bPath, entries)
const sum = (m) => [...m.values()].reduce((x, y) => x + y, 0)

console.log(`base : ${A.total} functions, ${A.entryOwned} entry-owned, ${A.unattributed} unattributed, ${sum(A.counts)} non-entry`)
console.log(`pert : ${B.total} functions, ${B.entryOwned} entry-owned, ${B.unattributed} unattributed, ${sum(B.counts)} non-entry`)

let matched = 0
const unmatched = []
for (const [c, n] of A.counts) {
  const have = B.counts.get(c) ?? 0
  const take = Math.min(n, have)
  matched += take
  if (take < n) unmatched.push([A.names.get(c), n - take, c])
}
console.log(`non-entry functions matched up to positional ids : ${matched} / ${sum(A.counts)}  (${(100 * matched / Math.max(1, sum(A.counts))).toFixed(3)}%)`)
console.log(`unmatched canonical forms                        : ${unmatched.length}`)
for (const [n, c, form] of unmatched.slice(0, 15)) console.log(`   x${c}  ${n}\n      ${form.slice(0, 400)}`)
