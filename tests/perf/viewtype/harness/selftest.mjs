// Prove the scorer can FAIL, and can say "no difference".
//
// The rule this exists for: an empty result from a broken query is
// indistinguishable from a true negative.  The matrix's headline is "5 of
// 1,160 cells are wrong", which is a claim about 1,155 cells that reported
// nothing -- so the scorer has to be shown answering WRONG when an answer
// differs, DID-NOT-RUN when an answer is missing, and clean when it is not.
//
// Every control below is ARMED: it constructs an input the scorer must
// reject, and this file exits non-zero if the scorer accepts it.
//
// usage: node selftest.mjs <runs-dir>
//   reads runs/node-D.txt and runs/post-D-llvm.json from that directory.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runs = process.argv[2] ?? join(import.meta.dirname, '..', 'runs')
const here = import.meta.dirname
const TAB = String.fromCharCode(9)
const tmp = mkdtempSync(join(tmpdir(), 'viewtype-selftest-'))

// The scored file carries every cell's verdict AND the answer each side
// gave, so a run transcript can be rebuilt from it -- no second artifact
// has to be kept in sync with it.
const scored = JSON.parse(readFileSync(join(runs, 'post-D-llvm.json'), 'utf8'))
const cells = {}
const lines = []
for (const r of scored.rows) {
  cells[r.id] = { start: 1, end: 1, off: r.verdict === 'TRAP' }
  if (r.got !== null) lines.push(r.id + TAB + r.got)
}
const cellsPath = join(tmp, 'cells.json')
const gotPath = join(tmp, 'got.txt')
const nodePath = join(runs, 'node-D.txt')
writeFileSync(cellsPath, JSON.stringify(cells))
writeFileSync(gotPath, lines.join('\n') + '\n')

const score = (got) =>
  JSON.parse(
    execFileSync(process.execPath, [join(here, 'score.mjs'), cellsPath, join(tmp, 'no-reasons.json'), nodePath, got, join(tmp, 'out.json')], {
      encoding: 'utf8',
    }).split('\n')[0],
  )

const checks = []
const check = (name, cond, detail) => {
  checks.push({ name, ok: cond, detail })
}

// 0. NO DIFFERENCE. The rebuilt transcript must score exactly as the run
//    it was rebuilt from -- if this fails, nothing below means anything.
const base = score(gotPath)
const want = { MATCH: scored.tally.MATCH, WRONG: scored.tally.WRONG, TRAP: scored.tally.TRAP }
check(
  'a faithful transcript reproduces the recorded tally',
  base.MATCH === want.MATCH && base.WRONG === want.WRONG && base.TRAP === want.TRAP,
  JSON.stringify(base) + ' vs ' + JSON.stringify(want),
)

// 1. ARMED: flip one answer. The scorer must report exactly one more WRONG.
const flipped = lines.map((l, i) =>
  i === 0 ? l.replace(/(true|false)$/, (m) => (m === 'true' ? 'false' : 'true')) : l,
)
writeFileSync(join(tmp, 'flip.txt'), flipped.join('\n') + '\n')
const f = score(join(tmp, 'flip.txt'))
check('one flipped answer is reported WRONG', f.WRONG === base.WRONG + 1, JSON.stringify(f))

// 2. ARMED: delete one answer. A cell that was compiled in and produced no
//    line is DID-NOT-RUN -- never a silent pass.
writeFileSync(join(tmp, 'drop.txt'), lines.slice(1).join('\n') + '\n')
const d = score(join(tmp, 'drop.txt'))
check(
  'a missing answer is reported DID-NOT-RUN, not MATCH',
  d['DID-NOT-RUN'] === 1 && d.MATCH === base.MATCH - 1,
  JSON.stringify(d),
)

// 3. ARMED: an answer with no oracle line. The scorer must say NO-ORACLE
//    rather than score it against undefined.
writeFileSync(join(tmp, 'extra.json'), JSON.stringify({ ...cells, 'D:nosuch:Cell': { start: 1, end: 1, off: false } }))
const e = JSON.parse(
  execFileSync(process.execPath, [join(here, 'score.mjs'), join(tmp, 'extra.json'), join(tmp, 'no-reasons.json'), nodePath, gotPath, join(tmp, 'out2.json')], {
    encoding: 'utf8',
  }).split('\n')[0],
)
check('a cell the oracle never answered is reported NO-ORACLE', e['NO-ORACLE'] === 1, JSON.stringify(e))

let bad = 0
for (const c of checks) {
  console.log((c.ok ? 'ok   ' : 'FAIL ') + c.name + (c.ok ? '' : '  -- ' + c.detail))
  if (!c.ok) bad++
}
console.log(bad === 0 ? 'selftest: 4/4' : 'selftest: ' + (checks.length - bad) + '/' + checks.length)
process.exit(bad === 0 ? 0 : 1)
