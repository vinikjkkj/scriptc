/* Can a per-module cache replay today's positional-id numbering?
 *
 * Reads a SCRIPTC_MINT_ORDER log and asks two questions of the mint
 * sequence:
 *
 *   1. HOW BIG IS THE TAIL. Ids minted in the phases after the file loop
 *      (the monomorphization fixpoint, class expressions, lifted fns, the
 *      post-passes) are minted while draining queues that interleave across
 *      modules. No fragment owns them. If the tail is empty, a re-mint can
 *      reproduce today's numbering exactly and costs nothing.
 *   2. ARE THE PER-MODULE RUNS CONTIGUOUS. Within the file loop, every id a
 *      module mints should form one unbroken run. A module whose ids are
 *      split by another module's is interleaved even inside the loop, and
 *      then even the body phase cannot be replayed per module.
 *
 * "Collection" is counted separately: it runs before any body and is a
 * single whole-program phase, so its ids are deterministic given the module
 * set and are not a barrier -- but they are also not attributable to one
 * module, so they are reported rather than folded into either bucket.
 */
import { readFileSync } from 'node:fs'

const f = process.argv[2]
if (!f) { console.error('usage: node mint-contiguity.mjs <mint-order.jsonl>'); process.exit(2) }

for (const line of readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)) {
  const { program, mints } = JSON.parse(line)
  const total = mints.length
  const bucket = (p) => p === 'collect' ? 'collect' : p.startsWith('tail:') ? 'tail' : p.startsWith('body:') || p.startsWith('init:') ? 'files' : 'other:' + p
  const counts = {}
  for (const m of mints) counts[bucket(m.phase)] = (counts[bucket(m.phase)] ?? 0) + 1

  // Contiguity of the FILE phases: walk the sequence and count how many
  // times the owning file changes. With N files touched, the minimum number
  // of runs is N; anything above that is interleaving.
  const fileSeq = mints.filter((m) => m.phase.startsWith('body:') || m.phase.startsWith('init:'))
    .map((m) => m.phase.slice(m.phase.indexOf(':') + 1))
  let runs = 0
  for (let i = 0; i < fileSeq.length; i++) if (i === 0 || fileSeq[i] !== fileSeq[i - 1]) runs++
  const distinctFiles = new Set(fileSeq).size

  // Where the tail's ids sit in the number line: a tail confined to the END
  // is a suffix a re-mint can append, which is a much weaker problem than a
  // tail scattered through the range.
  const tailIdx = mints.map((m, i) => [m, i]).filter(([m]) => m.phase.startsWith('tail:')).map(([, i]) => i)
  const firstTail = tailIdx.length ? tailIdx[0] : null

  const pct = (n) => (100 * n / total).toFixed(1) + '%'
  console.log(`\n==== ${program}`)
  console.log(`total ids minted        ${total}`)
  console.log(`  collection            ${counts.collect ?? 0}  ${pct(counts.collect ?? 0)}   (whole-program, before any body)`)
  console.log(`  file bodies + inits   ${counts.files ?? 0}  ${pct(counts.files ?? 0)}   across ${distinctFiles} files`)
  console.log(`  TAIL (queues/lifted)  ${counts.tail ?? 0}  ${pct(counts.tail ?? 0)}`)
  for (const k of Object.keys(counts)) if (k.startsWith('other:')) console.log(`  ${k}  ${counts[k]}`)
  console.log(`file-phase runs         ${runs} (minimum possible ${distinctFiles})  ` +
    (runs === distinctFiles ? 'CONTIGUOUS -- each file mints one unbroken run' : `INTERLEAVED -- ${runs - distinctFiles} extra switches`))
  console.log(`first tail id at index  ${firstTail === null ? 'n/a (no tail)' : firstTail + ' of ' + total + (firstTail >= (counts.collect ?? 0) + (counts.files ?? 0) ? '  (tail is a pure SUFFIX)' : '  (tail is INTERLEAVED into the range)')}`)
}
