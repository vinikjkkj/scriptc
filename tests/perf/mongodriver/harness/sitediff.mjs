/* sitediff.mjs — compare two sites.mjs records by SITE IDENTITY, never by count.
 *
 *   node sitediff.mjs <baseline.json> <probe.json> [--owner mongodb,bson] [--norm] [--full]
 *
 * Why identity and not counts: a four-line probe in this project once produced
 * "37 cleared against 27 added" where the added sites were the CLEARED sites
 * shifted down by four lines. A count called that a finding. So:
 *
 *   - every arm must be LINE-NEUTRAL (the probe edit keeps the file's line
 *     count identical), and this tool CHECKS that: when the same
 *     (file, code, message) exists on both sides at a different line it is
 *     reported as MOVED, never as one cleared plus one added.
 *   - the report lists the identities, not just how many.
 *
 * --norm keys a site on <commit12>/<path-inside-the-checkout> instead of the
 * absolute path, so two runs whose provenance CACHE ROOTS differ can be
 * compared at all. Without it every site reads as cleared AND added at once,
 * which a count would report as "242 fixed, 242 new". Use it only when the
 * roots really differ: it deliberately erases which cache a site came from.
 * It is negative-controlled by --selftest.
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
/* own.mjs, not cluster.mjs: cluster.mjs reads argv at module scope and used to
 * consume THIS file's --selftest and exit 0, so the pass line printed here was
 * cluster's and sitediff's own self-test never ran. */
const { ownerOf, canonPath } = await import('./own.mjs')

const norm = args.includes('--norm')
function canonWith(on, f) { return on ? canonPath(f) : f }

if (args.includes('--selftest')) {
  const A = '<blocks>/aaa-prov/387b6dd29e0aef37fb36607c4a0c652ef0878029/src/operations/operation.ts'
  const B = '<blocks>/bbb/probe/P1/prov/387b6dd29e0aef37fb36607c4a0c652ef0878029/src/operations/operation.ts'
  let bad = 0
  if (canonWith(true, A) !== canonWith(true, B)) { console.error('SELFTEST FAILED: --norm did not equate two cache roots'); bad++ }
  if (canonWith(false, A) === canonWith(false, B)) { console.error('SELFTEST FAILED: without --norm two cache roots compared equal'); bad++ }
  const C = 'G:/x/302f96e9591c6d4571480d69bb319266c281f67c/src/long.ts'
  if (canonWith(true, A) === canonWith(true, C)) { console.error('SELFTEST FAILED: --norm equated two DIFFERENT packages'); bad++ }
  const D = 'G:/x/387b6dd29e0aef37fb36607c4a0c652ef0878029/src/operations/command.ts'
  if (canonWith(true, A) === canonWith(true, D)) { console.error('SELFTEST FAILED: --norm equated two different files in one package'); bad++ }
  if (bad > 0) process.exit(3)
  console.error('sitediff.mjs selftest ok: --norm equates cache roots, and equates nothing else')
  if (args.length === 1) process.exit(0)
}

if (args.length < 2) { console.error('usage: node sitediff.mjs <base.json> <probe.json> [--owner a,b] [--norm] [--full]'); process.exit(1) }

const load = (p) => {
  const r = JSON.parse(readFileSync(p, 'utf8'))
  if (!Array.isArray(r.sites)) throw new Error('BLIND: ' + p + ' has no sites array')
  if (!r.stats) throw new Error('BLIND: ' + p + ' has no stats')
  return r
}
const A = load(args[0])
const B = load(args[1])

const oi = args.indexOf('--owner')
const want = oi >= 0 ? new Set(args[oi + 1].split(',')) : null
const pick = (r) => r.sites.filter((s) => s.section === 'blocker').filter((s) => !want || want.has(ownerOf(s.file)))
const a = pick(A)
const b = pick(B)

const canon = (f) => canonWith(norm, f)
const idOf = (s) => canon(s.file) + ':' + s.line + ' ' + s.code + ' ' + s.message
const noLine = (s) => canon(s.file) + ' ' + s.code + ' ' + s.message

const aById = new Map(); for (const s of a) aById.set(idOf(s), s)
const bById = new Map(); for (const s of b) bById.set(idOf(s), s)

const clearedRaw = a.filter((s) => !bById.has(idOf(s)))
const addedRaw = b.filter((s) => !aById.has(idOf(s)))

/* MOVED: same (file, code, message) on both sides at a different line. Almost
 * always the probe was not line-neutral. These are NOT cleared and NOT added. */
const aNoLine = new Map(); for (const s of clearedRaw) { const k = noLine(s); aNoLine.set(k, (aNoLine.get(k) ?? []).concat([s])) }
const bNoLine = new Map(); for (const s of addedRaw) { const k = noLine(s); bNoLine.set(k, (bNoLine.get(k) ?? []).concat([s])) }
const moved = []
for (const [k, av] of aNoLine) {
  const bv = bNoLine.get(k)
  if (!bv) continue
  const n = Math.min(av.length, bv.length)
  for (let i = 0; i < n; i++) moved.push([av[i], bv[i]])
}
const movedA = new Set(moved.map((p) => idOf(p[0])))
const movedB = new Set(moved.map((p) => idOf(p[1])))
const cleared = clearedRaw.filter((s) => !movedA.has(idOf(s)))
const added = addedRaw.filter((s) => !movedB.has(idOf(s)))

const strip = (f) => f.replace(/^.*?\/[0-9a-f]{40}\//, '')
const show = (label, list, full) => {
  console.log('\n## ' + label + ': ' + list.length)
  const byMsg = new Map()
  for (const s of list) { const k = s.code + ' ' + s.message; byMsg.set(k, (byMsg.get(k) ?? []).concat([s])) }
  for (const e of [...byMsg].sort((x, y) => y[1].length - x[1].length)) {
    console.log('  ' + String(e[1].length).padStart(4) + '  ' + e[0].slice(0, 190))
    for (const s of (full ? e[1] : e[1].slice(0, 6))) console.log('         @ ' + strip(s.file) + ':' + s.line)
    if (!full && e[1].length > 6) console.log('         ... ' + (e[1].length - 6) + ' more')
  }
}

console.log('baseline: ' + args[0])
console.log('  entry=' + A.entry + ' stats=' + JSON.stringify(A.stats))
console.log('probe   : ' + args[1])
console.log('  entry=' + B.entry + ' stats=' + JSON.stringify(B.stats))
console.log('\nnorm=' + norm + '  scope' + (want ? ' ' + [...want].join('+') : ' ALL') + ': baseline ' + a.length + ' blocker sites, probe ' + b.length)

if (moved.length > 0) {
  console.log('\n!! ' + moved.length + ' sites MOVED (same file+code+message, different line).')
  console.log('!! The probe was NOT line-neutral. These are neither cleared nor added.')
  for (const p of moved.slice(0, 12)) console.log('     ' + strip(p[0].file) + ':' + p[0].line + ' -> :' + p[1].line + '  ' + p[0].code)
} else {
  console.log('\nline-neutral: no site moved lines (0 MOVED)')
}
const full = args.includes('--full')
show('CLEARED (in baseline, gone in probe)', cleared, full)
show('ADDED (new in probe)', added, full)
console.log('\nNET: ' + a.length + ' -> ' + b.length + '  (cleared ' + cleared.length + ', added ' + added.length + ', moved ' + moved.length + ')')
