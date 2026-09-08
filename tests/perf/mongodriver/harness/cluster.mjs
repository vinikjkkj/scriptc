/* cluster.mjs — cluster a sites.mjs record's blocker sites by owner package,
 * diagnostic code, normalised message family and file.
 *
 *   node cluster.mjs <record.json> [--owner mongodb,bson] [--json out.json]
 *
 * Why this exists: the store-mongo record has 238-242 blocker sites and a
 * by-file or by-code tally answers neither "how many INDEPENDENT causes" nor
 * "what would one fix clear". A message like
 *   "extending the generic class 'CommandOperation' without a compiled
 *    concrete instantiation"
 * is one cause quoted at N sites; the raw `distinct msgs` column counts the
 * quoted identifier and so reports N. This normalises the identifiers OUT of
 * the message before counting families, and reports both numbers side by side
 * so the inflation is visible rather than hidden.
 *
 * HARDENING / CONTROLS (this instrument must be unable to say "nothing" by
 * accident — three inflated numbers in one day came from tallies that could
 * only say yes):
 *   - throws if the record has no `sites` array or no `stats`
 *   - throws if it read zero blocker sites AND the record claims failures
 *   - `--selftest` runs the normaliser over fixed inputs with known answers
 *     and exits non-zero if any disagrees (a positive AND a negative case)
 */
import { readFileSync, writeFileSync } from 'node:fs'

/* Owner attribution. The provenance lane checks each attested tree out under
 * <SCRIPTC_PROVENANCE_CACHE>/<commit>/, so the commit digest IS the package
 * identity. Anything else is attributed by path. Unknown commits are reported
 * as `?<sha12>` and never silently folded into a known bucket. */
import { ownerOf, family } from './own.mjs'

function selftest() {
  const cases = [
    // positive: two different quoted classes must collapse to one family
    [
      "extending the generic class 'CommandOperation' without a compiled concrete instantiation",
      "extending the generic class 'AbstractCursor' without a compiled concrete instantiation",
      true,
    ],
    // negative: two genuinely different rules must NOT collapse
    [
      "extending the generic class 'X' without a compiled concrete instantiation",
      "'X' is part of the standard library types but has no scriptc lowering yet",
      false,
    ],
    // negative control on the identifier stripper: it must not eat plain words
    ['values of type A have no static representation', 'values of type B have no static representation', false],
    // positive: the instantiation-context suffix carries UNQUOTED type args, so
    // the quoted-identifier stripper cannot see them. Eight refusals of ONE line
    // at operation.ts:92 read as eight causes until this is stripped too.
    [
      "'this.constructor' is part of the standard library types but has no scriptc lowering yet (instantiating class 'AbstractOperation' with <boolean>)",
      "'this.constructor' is part of the standard library types but has no scriptc lowering yet (instantiating class 'AbstractOperation' with <m41.CursorResponse>)",
      true,
    ],
    // negative: the suffix must not swallow the message BEFORE it
    [
      "'this.constructor' is part of the standard library types but has no scriptc lowering yet (instantiating class 'A' with <T>)",
      "method calls like 'response.toObject' is not supported yet (instantiating class 'A' with <T>)",
      false,
    ],
    // negative: a diagnostic WITHOUT the suffix must not equal one WITH it
    [
      "extending generic classes are not supported yet",
      "extending generic classes are not supported yet (instantiating class 'A' with <T>)",
      false,
    ],
  ]
  let bad = 0
  for (const [a, b, same] of cases) {
    const got = family(a) === family(b)
    if (got !== same) {
      console.error(`SELFTEST FAILED: family(${JSON.stringify(a)}) === family(${JSON.stringify(b)}) is ${got}, want ${same}`)
      bad++
    }
  }
  // ownerOf must discriminate, and must not fold an unknown sha into a known bucket
  const o1 = ownerOf('G:/x/387b6dd29e0aef37fb36607c4a0c652ef0878029/src/utils.ts')
  const o2 = ownerOf('G:/x/302f96e9591c6d4571480d69bb319266c281f67c/src/long.ts')
  const o3 = ownerOf('G:/x/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef/src/a.ts')
  const o4 = ownerOf('G:/x/9a49e1fffdec8bbfae14cd64c98ffa88c36ef13e/packages/store-mongo/src/createMongoStore.ts')
  if (o1 !== 'mongodb') { console.error(`SELFTEST FAILED: ownerOf mongodb -> ${o1}`); bad++ }
  if (o2 !== 'bson') { console.error(`SELFTEST FAILED: ownerOf bson -> ${o2}`); bad++ }
  if (!o3.startsWith('?')) { console.error(`SELFTEST FAILED: unknown sha folded into ${o3}`); bad++ }
  if (o4 !== '@zapo-js/store-mongo') { console.error(`SELFTEST FAILED: store-mongo path -> ${o4}`); bad++ }
  if (bad > 0) process.exit(3)
  console.error('cluster.mjs selftest ok: 3 family cases, 4 owner cases, positive and negative')
}

if (process.argv.includes('--selftest')) { selftest(); if (process.argv.length === 3) process.exit(0) }

const args = process.argv.slice(2).filter((a) => a !== '--selftest')
if (args.length === 0) { console.error('usage: node cluster.mjs <record.json> [--owner a,b] [--json out.json]'); process.exit(1) }
const rec = JSON.parse(readFileSync(args[0], 'utf8'))

if (!Array.isArray(rec.sites)) throw new Error('BLIND: record has no sites array')
if (!rec.stats || typeof rec.stats.statementsTotal !== 'number') throw new Error('BLIND: record has no numeric stats')

let blockers = rec.sites.filter((s) => s.section === 'blocker')
if (blockers.length === 0 && rec.stats.statementsFailed > 0) {
  throw new Error('BLIND: zero blocker sites read but the record reports failed statements')
}

const wantIdx = args.indexOf('--owner')
const want = wantIdx >= 0 ? new Set(args[wantIdx + 1].split(',')) : null
const all = blockers
if (want) blockers = blockers.filter((s) => want.has(ownerOf(s.file)))

const key = (s) => `${ownerOf(s.file)}\u0000${s.code}\u0000${family(s.message)}`
const groups = new Map()
for (const s of blockers) {
  const k = key(s)
  let g = groups.get(k)
  if (!g) { g = { owner: ownerOf(s.file), code: s.code, family: family(s.message), sites: [], files: new Set(), rawMsgs: new Set() }; groups.set(k, g) }
  g.sites.push(s)
  g.files.add(s.file)
  g.rawMsgs.add(s.message)
}
const list = [...groups.values()].sort((a, b) => b.sites.length - a.sites.length)

const byOwnerAll = new Map()
for (const s of all) byOwnerAll.set(ownerOf(s.file), (byOwnerAll.get(ownerOf(s.file)) ?? 0) + 1)

console.log(`record: ${rec.entry}`)
console.log(`flags: ${JSON.stringify(rec.flags)}  stats: ${JSON.stringify(rec.stats)}`)
console.log(`blocker sites, ALL owners: ${all.length}`)
console.log('\n# by owner (all)')
for (const [o, n] of [...byOwnerAll].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), o)

const rawDistinct = new Set(blockers.map((s) => s.message)).size
console.log(`\n# scope${want ? ' ' + [...want].join('+') : ''}: ${blockers.length} sites`)
console.log(`  distinct RAW messages : ${rawDistinct}`)
console.log(`  distinct FAMILIES     : ${list.length}   <- causes, after quoted identifiers are normalised out`)
console.log(`  distinct files        : ${new Set(blockers.map((s) => s.file)).size}`)

console.log('\n# families by site count')
console.log('sites  files  rawmsgs  code    owner          family')
for (const g of list) {
  console.log(
    String(g.sites.length).padStart(5),
    String(g.files.size).padStart(6),
    String(g.rawMsgs.size).padStart(8),
    ' ',
    (g.code ?? '?').padEnd(7),
    g.owner.padEnd(14),
    g.family.length > 150 ? g.family.slice(0, 150) + '…' : g.family,
  )
}

const jsonIdx = args.indexOf('--json')
if (jsonIdx >= 0) {
  writeFileSync(args[jsonIdx + 1], JSON.stringify({
    entry: rec.entry, flags: rec.flags, stats: rec.stats,
    byOwnerAll: Object.fromEntries(byOwnerAll),
    families: list.map((g) => ({ owner: g.owner, code: g.code, family: g.family, sites: g.sites.length, files: [...g.files], rawMsgs: [...g.rawMsgs], locations: g.sites.map((s) => `${s.file}:${s.line}`) })),
  }, null, 1))
  console.log(`\nwrote ${args[jsonIdx + 1]}`)
}
