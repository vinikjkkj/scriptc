/**
 * read-poolstat.mjs - read one scr_pool_stat.h report and REFUSE it if the
 * lane cannot be shown to have run.
 *
 * The refusals, and each one is a way a report has been believed before:
 *   * no file, or no POOLSTAT-END line     -> the process died before the
 *     report, or _Exit was not interposed. A truncated report reads as a
 *     complete one with smaller numbers.
 *   * cfgSeen=0                            -> the registration constructors
 *     did not compile, so grain/max/depth/budget are zeroes that look like
 *     answers.
 *   * lost>0                               -> more pools than table rows;
 *     some pool's traffic is uncounted and would read as absent.
 *   * an all-zero report with no arm       -> "nothing happened" and
 *     "nothing ran" are the same file unless the arm is planted.
 *
 * usage: node read-poolstat.mjs <report.txt> [--arm N] [--json]
 */
import { readFileSync, existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const file = argv.find((a) => !a.startsWith('--'))
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] ?? d) }
const JSONOUT = argv.includes('--json')

if (!file) { console.error('usage: node read-poolstat.mjs <report.txt> [--arm N]'); process.exit(64) }
if (!existsSync(file)) { console.error('REFUSED: no such report: ' + file); process.exit(1) }

const text = readFileSync(file, 'utf8')
const lines = text.split(/\r?\n/)
const refusals = []

if (!lines.some((l) => l === 'POOLSTAT-END')) refusals.push('report is TRUNCATED (no POOLSTAT-END)')

const head = lines.find((l) => l.startsWith('POOLSTAT-HEAD '))
if (!head) refusals.push('no POOLSTAT-HEAD line')
const kv = (s) => Object.fromEntries([...s.matchAll(/([A-Za-z0-9_]+)=(-?\d+)/g)].map((m) => [m[1], Number(m[2])]))
const H = head ? kv(head) : {}
if (head && H.cfgSeen !== 1) refusals.push('cfgSeen=0: the per-TU registrations did not compile; grain/max/depth/budget are not the build\'s')
if (head && H.lost > 0) refusals.push(`lost=${H.lost}: more pools than table rows, some traffic is uncounted`)

const bounds = []
for (const l of lines) { const m = /^POOLSTAT-BOUND (\d+) (\d+)$/.exec(l); if (m) bounds[Number(m[1])] = Number(m[2]) }

const rows = []
for (const l of lines) {
  if (!l.startsWith('POOLSTAT ')) continue
  const name = l.split(/\s+/)[1]
  const r = kv(l.slice(('POOLSTAT ' + name).length))
  r.name = name
  r.addr = /addr=([0-9a-f]+)/.exec(l)?.[1] ?? '?'
  r.wr = bounds.map((_, i) => r['wr' + i] ?? 0)
  rows.push(r)
}
if (rows.length === 0) refusals.push('no POOLSTAT rows at all')

// The arm. Its expected contents are arithmetic, and they differ between the
// two POLICIES -- which is the property that makes this lane able to
// adjudicate the budget rather than merely to report on it.
const armN = flag('arm') === null ? (H.arm ?? 0) : Number(flag('arm'))
const arm = rows.find((r) => r.name === 'ARM')
if (armN > 0) {
  if (!arm) refusals.push(`arm=${armN} was built in but no ARM row came back`)
  else {
    const sz = (H.grain || 8) * 2
    const expAccept = H.budget > 0 ? armN : Math.min(armN, H.depth)
    const expReject = armN - expAccept
    const bad = []
    const inGive = arm.giveCalls - arm.giveOOR
    if (inGive !== armN) bad.push(`in-range gives ${inGive} != ${armN}`)
    if (arm.accepts !== expAccept) bad.push(`accepts ${arm.accepts} != ${expAccept}`)
    if (arm.rejects !== expReject) bad.push(`rejects ${arm.rejects} != ${expReject}`)
    if (arm.hits !== expAccept) bad.push(`hits ${arm.hits} != ${expAccept}`)
    if (arm.bytesMax !== expAccept * sz) bad.push(`bytesMax ${arm.bytesMax} != ${expAccept * sz}`)
    if (bad.length) refusals.push('ARM row does not match arithmetic: ' + bad.join('; '))
  }
} else if (rows.every((r) => r.giveCalls === 0 && r.takeCalls === 0)) {
  refusals.push('every row is zero and no arm was planted: "nothing happened" is indistinguishable from "nothing ran"')
}

const fmt = (n) => n.toLocaleString('en-US')
const kib = (n) => (n / 1024).toFixed(1) + ' KiB'

if (JSONOUT) {
  console.log(JSON.stringify({ file, head: H, bounds, rows, refusals }, null, 2))
} else {
  console.log(`report   ${file}`)
  console.log(`build    budget=${H.budget ? fmt(H.budget) + ' B (' + (H.budget / 1048576) + ' MiB)' : '0 (OFF, per-class depth ' + H.depth + ')'}  grain=${H.grain}  max=${H.max}`)
  console.log(`rows=${H.rows} lost=${H.lost} arm=${H.arm}`)
  console.log('')
  const w = Math.max(8, ...rows.map((r) => r.name.length))
  const pad = (s, n) => String(s).padStart(n)
  console.log(`${'pool'.padEnd(w)} ${pad('takes', 12)} ${pad('hits', 12)} ${pad('hit%', 7)} ${pad('gives', 12)} ${pad('accepts', 12)} ${pad('rejects', 10)} ${pad('rej%', 7)} ${pad('bytesMax', 12)} ${pad('heldAtExit', 11)}`)
  for (const r of rows) {
    const inTake = r.takeCalls - r.takeOOR
    const inGive = r.giveCalls - r.giveOOR
    console.log(`${r.name.padEnd(w)} ${pad(fmt(r.takeCalls), 12)} ${pad(fmt(r.hits), 12)} ${pad(inTake ? (100 * r.hits / inTake).toFixed(2) : '-', 7)} ${pad(fmt(r.giveCalls), 12)} ${pad(fmt(r.accepts), 12)} ${pad(fmt(r.rejects), 10)} ${pad(inGive ? (100 * r.rejects / inGive).toFixed(3) : '-', 7)} ${pad(fmt(r.bytesMax), 12)} ${pad(fmt(r.bytesNow), 11)}`)
  }
  console.log('')
  console.log('WOULD-REJECT, same retention history, other bounds (in-range gives turned away):')
  const bh = bounds.map((b) => pad(b >= 1048576 ? b / 1048576 + 'M' : b / 1024 + 'K', 10)).join(' ')
  console.log(`${'pool'.padEnd(w)} ${bh} ${pad('depth64', 10)} ${pad('inGives', 12)}`)
  for (const r of rows) {
    const inGive = r.giveCalls - r.giveOOR
    console.log(`${r.name.padEnd(w)} ${r.wr.map((v) => pad(fmt(v), 10)).join(' ')} ${pad(fmt(r.wouldRejectDepth64), 10)} ${pad(fmt(inGive), 12)}`)
  }
  console.log('')
  const real = rows.filter((r) => r.name !== 'ARM')
  const peak = real.reduce((a, r) => a + r.bytesMax, 0)
  console.log(`sum of per-pool byte high-water marks, ARM excluded: ${fmt(peak)} B = ${kib(peak)}`)
  if (H.budget) {
    const worst = Math.max(0, ...real.map((r) => r.bytesMax))
    console.log(`largest single pool high-water: ${fmt(worst)} B = ${kib(worst)}  = ${(100 * worst / H.budget).toFixed(4)}% of the ${H.budget / 1048576} MiB bound`)
  }
}

if (refusals.length) {
  console.log('')
  for (const r of refusals) console.log('REFUSED: ' + r)
  process.exit(1)
}
console.log('')
console.log('accepted: the lane ran, the arm reads back as arithmetic, and no pool is uncounted.')
