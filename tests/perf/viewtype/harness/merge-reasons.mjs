// Accumulate the FIRST reason each cell was refused, across iterations.
// argv: <reasons.json (created if absent)> <attr.json>
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
const out = process.argv[2]
const acc = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {}
const attr = JSON.parse(readFileSync(process.argv[3], 'utf8'))
for (const [id, msg] of Object.entries(attr.newly)) if (!(id in acc)) acc[id] = msg
writeFileSync(out, JSON.stringify(acc, null, 1))
console.log('reasons=' + Object.keys(acc).length)
