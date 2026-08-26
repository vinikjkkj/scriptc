// Map compiler diagnostics onto matrix cells.
//
// argv: <cells.json> <build-log> [previously-disabled.json]
// stdout: JSON { disabled: [...ids], newly: {id: "SCxxxx: message"}, orphan: [...] }
//
// An "orphan" is a diagnostic whose line belongs to NO cell -- the preamble,
// or a line the generator did not account for.  Orphans are reported loudly
// rather than swallowed: a diagnostic the attribution cannot place would
// otherwise vanish and look like a clean build.

import { readFileSync } from 'node:fs'

const cells = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const log = readFileSync(process.argv[3], 'utf8')
const prev = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : []

const owner = new Map()
for (const [id, c] of Object.entries(cells)) {
  for (let l = c.start; l <= c.end; l++) owner.set(l, id)
}

const re = new RegExp('probe-[A-Z]\\.ts:(\\d+):(\\d+) - error (SC\\d+): (.*)$', 'gm')
const newly = {}
const orphan = []
let total = 0
let m
while ((m = re.exec(log)) !== null) {
  total++
  const line = Number(m[1])
  const id = owner.get(line)
  const msg = m[3] + ': ' + m[4].trim()
  if (id === undefined) { orphan.push(line + ' ' + msg); continue }
  // SC2004 "uses of X inherit the blocker on its declaration" is a CASCADE of
  // the declaration's own diagnostic in the same cell -- keep the root cause.
  if (newly[id] && m[3] === 'SC2004') continue
  if (newly[id] && newly[id].startsWith('SC2004')) { newly[id] = msg; continue }
  if (!newly[id]) newly[id] = msg
}

const disabled = [...new Set([...prev, ...Object.keys(newly)])].sort()
process.stdout.write(JSON.stringify({ diagnostics: total, disabled, newly, orphan }, null, 1))
