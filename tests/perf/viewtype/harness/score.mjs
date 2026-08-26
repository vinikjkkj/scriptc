// Score one shape's compiled run against the node oracle.
//
// argv: <cells.json> <reasons.json> <node.txt> <scriptc.txt> <out.json>
//
// Categories
//   MATCH        both answered, byte-identical
//   WRONG        both answered, different  -- a SILENT wrong answer
//   TRAP         the compiler refused the cell by name (reason recorded)
//   DID-NOT-RUN  the cell was compiled in but produced no line (the program
//                stopped early, or the statement vanished) -- NOT a pass
//
// A cell missing from the ORACLE output is a harness bug and is reported as
// NO-ORACLE rather than silently dropped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const cells = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const reasons = existsSync(process.argv[3]) ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : {}
const parse = (p) => {
  const m = new Map()
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf(String.fromCharCode(9))
    if (i < 0) continue
    m.set(line.slice(0, i), line.slice(i + 1))
  }
  return m
}
const node = parse(process.argv[4])
const got = parse(process.argv[5])

const rows = []
const tally = { MATCH: 0, WRONG: 0, TRAP: 0, 'DID-NOT-RUN': 0, 'NO-ORACLE': 0 }
for (const [id, c] of Object.entries(cells)) {
  const want = node.get(id)
  const have = got.get(id)
  let verdict
  if (want === undefined) verdict = 'NO-ORACLE'
  else if (c.off) verdict = 'TRAP'
  else if (have === undefined) verdict = 'DID-NOT-RUN'
  else verdict = have === want ? 'MATCH' : 'WRONG'
  tally[verdict]++
  rows.push({ id, verdict, node: want ?? null, got: have ?? null, reason: reasons[id] ?? null })
}
writeFileSync(process.argv[6], JSON.stringify({ tally, rows }, null, 1))
console.log(JSON.stringify(tally))
for (const r of rows) if (r.verdict === 'WRONG') console.log('WRONG ' + r.id + ' got=' + r.got + ' node=' + r.node)
for (const r of rows) if (r.verdict === 'DID-NOT-RUN') console.log('DNR   ' + r.id)
for (const r of rows) if (r.verdict === 'NO-ORACLE') console.log('NOORC ' + r.id)
