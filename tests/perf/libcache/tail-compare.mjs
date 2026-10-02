/* Does the tail's drain order survive an entry edit?
 *
 * The tail is the ids minted by the monomorphization / class-expression /
 * emit-spec fixpoint, after every module's bodies are down. A per-module
 * cache re-lowers the entry and replays libraries from fragments, so the
 * question is whether the entities that fixpoint drains -- and the ORDER it
 * drains them in -- are the same when only the entry moved.
 *
 * COUNT BEFORE ORDER, and the two failures are not the same severity:
 *   an entity in base and MISSING from pert -> the two builds produced
 *     different PROGRAMS. Not a renaming; the cached path emitting
 *     something else. Reported first and separately.
 *   the shared entities in a different relative order -> a renumbering
 *     confined to the tail's own contiguous top range.
 *
 * THE KEY MUST BE ID-FREE, and the first version of this file was not.
 * ShapeRegistry.keyOf spells a nested type as `record:r3541`, so a key is
 * structural only ONE level deep: when the perturbation mints one extra
 * shape early, every nested reference below it shifts by one and identical
 * entities compare as absent. That first run reported 28 "missing" and 28
 * "added" -- a symmetric renumbering artifact -- and called it a different
 * program. The counts (105 vs 105) were the only part that meant anything.
 *
 * So every key is EXPANDED transitively here, substituting each `record:rN`
 * / `union:uN` with that id's own expanded key, until nothing but structure
 * remains. The mint log is self-contained for this: every id it references
 * was itself minted and logged. Cycles are cut with a De Bruijn-style
 * back-reference so a recursive shape still has one canonical spelling, and
 * the placeholders the registry mints before it knows a shape's fields
 * (`%rec`, 13 of 5,598 here) stay opaque and are COUNTED rather than
 * silently compared.
 */
import { readFileSync } from 'node:fs'

const REF = /\b(?:record|union):([ru]\d+)/g

function loadArm(file) {
  const { program, mints } = JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0])
  const keyById = new Map(mints.map((m) => [m.id, m.key]))
  const memo = new Map()
  const expand = (id, path) => {
    const at = path.indexOf(id)
    if (at >= 0) return `%back(${path.length - at})`          // cycle, canonical depth
    const raw = keyById.get(id)
    if (raw === undefined) return `%unminted`
    if (raw === '%rec') return `%rec`                          // placeholder, opaque by construction
    if (path.length === 0 && memo.has(id)) return memo.get(id)
    const next = [...path, id]
    const out = raw.replace(REF, (_, ref) => JSON.stringify(expand(ref, next)))
    if (path.length === 0) memo.set(id, out)
    return out
  }
  const tail = mints.filter((m) => m.phase.startsWith('tail:'))
  return {
    program,
    tail: tail.map((m) => ({ id: m.id, raw: m.key, key: expand(m.id, []) })),
  }
}

const A = loadArm(process.argv[2])
const B = loadArm(process.argv[3])

const opaque = (arm) => arm.tail.filter((t) => t.key.includes('%rec') || t.key.includes('%unminted')).length
const keysA = A.tail.map((t) => t.key)
const keysB = B.tail.map((t) => t.key)
const setA = new Set(keysA), setB = new Set(keysB)
const onlyA = A.tail.filter((t) => !setB.has(t.key))
const onlyB = B.tail.filter((t) => !setA.has(t.key))

console.log(`base  ${A.program}`)
console.log(`pert  ${B.program}`)
console.log(`\n--- COUNT (asked first: a missing entity is a different PROGRAM, not a renaming) ---`)
console.log(`tail entities            base ${A.tail.length}   pert ${B.tail.length}`)
console.log(`distinct expanded keys   base ${setA.size}   pert ${setB.size}   (collisions would fake agreement)`)
console.log(`carrying an opaque %rec  base ${opaque(A)}   pert ${opaque(B)}   (compared, but not fully structural)`)
console.log(`in base, ABSENT from pert   ${onlyA.length}   <-- must be 0`)
console.log(`in pert, absent from base   ${onlyB.length}   (the perturbation's own entities are expected here)`)
for (const t of onlyA.slice(0, 8)) console.log(`   MISSING ${t.id}: ${t.key.slice(0, 130)}`)
for (const t of onlyB.slice(0, 8)) console.log(`   added   ${t.id}: ${t.key.slice(0, 130)}`)

console.log(`\n--- ORDER (only meaningful once the count agrees) ---`)
const sharedA = keysA.filter((k) => setB.has(k))
const sharedB = keysB.filter((k) => setA.has(k))
let firstDiff = -1
for (let i = 0; i < Math.min(sharedA.length, sharedB.length); i++) {
  if (sharedA[i] !== sharedB[i]) { firstDiff = i; break }
}
const sameOrder = firstDiff === -1 && sharedA.length === sharedB.length
console.log(`shared entities  ${sharedA.length}`)
console.log(sameOrder
  ? 'ORDER STABLE -- the shared tail entities drain in the same relative order in both arms.'
  : `ORDER MOVED at shared index ${firstDiff}:\n   base: ${(sharedA[firstDiff] ?? '(end)').slice(0, 110)}\n   pert: ${(sharedB[firstDiff] ?? '(end)').slice(0, 110)}`)

const verdict = onlyA.length === 0 && sameOrder
console.log(`\nVERDICT ${verdict ? 'TAIL REPRODUCIBLE under an entry edit' : (onlyA.length ? 'DIFFERENT PROGRAM -- investigate before any ordering work' : 'TAIL REORDERS -- canonical mint order needed for the tail')}`)
