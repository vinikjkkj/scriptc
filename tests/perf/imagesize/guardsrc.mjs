/**
 * guardsrc.mjs - WHICH CALL does each emitted `if (scr_exc_pending())` guard?
 *
 * The emitter's contract is "after EVERY call that can throw (per the
 * may-throw analysis), test the pending flag and unwind". 107,177 of those
 * guards carry 43.7 MB of epilogue in zapo's bench. This ranks the guards by
 * the callee on the line immediately above, so the next block can ask the
 * only question that matters about them: how many of these callees can
 * actually throw?
 *
 * Usage: node guardsrc.mjs --c file.c [--top 30]
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const path = flag('c')
if (!path) { console.error('usage: --c file.c'); process.exit(2) }
const TOP = Number(flag('top', '30'))

const text = readFileSync(path, 'latin1')
const N = text.length
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const GUARD = 'if (scr_exc_pending()) {'
const counts = new Map()
const epiBytes = new Map()
let guards = 0, unattributed = 0

let prevLine = ''
let i = 0
while (i < N) {
  let eol = text.indexOf('\n', i)
  if (eol < 0) eol = N
  const line = text.slice(i, eol)
  const t = line.trim()
  if (t === GUARD) {
    guards++
    // the callee on the line above: the LAST `name(` before the last `)`
    const m = [...prevLine.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)]
    // prefer a runtime/emitted symbol over control keywords
    let name = null
    for (let k = m.length - 1; k >= 0; k--) {
      const c = m[k][1]
      if (c === 'if' || c === 'while' || c === 'for' || c === 'switch' || c === 'return' || c === 'sizeof') continue
      name = c
      break
    }
    if (name === null) { unattributed++; name = '(no call on the line above)' }
    counts.set(name, (counts.get(name) ?? 0) + 1)
    // measure this guard's epilogue body
    const indent = line.length - line.trimStart().length
    let j = eol + 1, body = 0
    while (j < N) {
      let e2 = text.indexOf('\n', j)
      if (e2 < 0) e2 = N
      const l2 = text.slice(j, e2)
      const ind2 = l2.length - l2.trimStart().length
      if (l2.trim() === '}' && ind2 === indent) { j = e2 + 1; break }
      body += l2.length + 1
      j = e2 + 1
    }
    epiBytes.set(name, (epiBytes.get(name) ?? 0) + body)
    prevLine = ''
    i = j
    continue
  }
  if (t.length > 0) prevLine = t
  i = eol + 1
}

let totalEpi = 0
for (const v of epiBytes.values()) totalEpi += v
console.log('file   ' + path)
console.log('guards ' + fmt(guards) + '   epilogue bytes ' + fmt(totalEpi) +
  '   unattributed ' + fmt(unattributed))
console.log('')
console.log('TOP ' + TOP + ' guarded callees, by epilogue bytes they carry')
console.log('     guards      epi bytes    %epi   avg  callee')
const rows = [...counts].map(([k, n]) => [k, n, epiBytes.get(k) ?? 0])
rows.sort((a, b) => b[2] - a[2])
for (const [k, n, b] of rows.slice(0, TOP)) {
  console.log(String(fmt(n)).padStart(11) + String(fmt(b)).padStart(15) +
    (100 * b / totalEpi).toFixed(2).padStart(8) +
    String(Math.round(b / n)).padStart(6) + '  ' + k)
}
console.log('')
console.log('distinct callees ' + fmt(rows.length))
