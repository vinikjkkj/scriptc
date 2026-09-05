/* The memory time series for one memrig run: presync, peak, settled, +30s, +60s,
 * in BOTH WorkingSet and PrivateCommit.
 *
 *   node memrig-report.mjs <runRoot> <tag> [--brief]
 *
 * <runRoot> is memrig's OUT directory, which holds <tag>.rss.csv (the kernel-side
 * sampler) and <tag>.phases.csv (the rig's markers). It is an ARGUMENT, never a
 * constant, and a run whose CSV is missing or empty says so and exits 2 rather
 * than printing a reassuring zero.
 *
 * Report the PEAK and the idle tail, never the last sample on its own: the final
 * reading of a single arm has been measured to range 6.0-80.2 MiB across six runs
 * of the same configuration, because it depends on when the sampler last fired.
 * PrivateCommit is reported beside WorkingSet because they answer different
 * questions -- resident pages versus commit charge, and a history sync moves them
 * by different factors. */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [runRoot, tag] = process.argv.slice(2)
const brief = process.argv.includes('--brief')
if (!runRoot || !tag) {
    console.log('usage: node memrig-report.mjs <runRoot> <tag> [--brief]')
    process.exit(2)
}
const csv = join(runRoot, `${tag}.rss.csv`)
const phc = join(runRoot, `${tag}.phases.csv`)
if (!existsSync(csv)) { console.log(`${tag}: NO SAMPLER CSV AT ${csv} — could not look`); process.exit(2) }
if (!existsSync(phc)) { console.log(`${tag}: NO PHASES CSV AT ${phc} — could not look`); process.exit(2) }

const rows = readFileSync(csv, 'utf8').trim().split(/\r?\n/)
    .map((l) => l.split(',').map(Number))
    .filter((r) => r.length === 3 && Number.isFinite(r[0]))
const phases = readFileSync(phc, 'utf8').trim().split(/\r?\n/).slice(1)
    .map((l) => { const i = l.indexOf(','); return { ms: Number(l.slice(0, i)), p: l.slice(i + 1) } })
if (!rows.length) { console.log(`${tag}: 0 SAMPLES — the sampler failed; this is not a zero`); process.exit(2) }

const M = (b) => (b / 1048576).toFixed(2)
const t0 = rows[0][0]
const at = (ms) => { let best = null; for (const r of rows) if (r[0] <= ms + 400) best = r; return best }
const find = (re) => phases.filter((p) => re.test(p.p))
const mark = (name) => at(phases.find((p) => p.p === name)?.ms ?? -1)

const pre = mark('PRESYNC-BASELINE')
const peakW = rows.reduce((a, b) => (b[1] > a[1] ? b : a))
const peakP = rows.reduce((a, b) => (b[2] > a[2] ? b : a))
const last = rows.at(-1)
const settledPh = phases.find((p) => /^SETTLED-r/.test(p.p)) ?? phases.find((p) => /^SYNC-DONE/.test(p.p))
const settled = settledPh ? at(settledPh.ms) : null
const idle30 = mark('IDLE-30s')
const idle60 = mark('IDLE-60s')
const sent = find(/^chunk-sent-/).length
const decoded = find(/^chunk-decoded-/).length
const refusals = find(/REFUSAL/).length

const row = (label, r) => (r
    ? `${label.padEnd(14)} ${M(r[1]).padStart(8)} MiB WS  ${M(r[2]).padStart(9)} MiB priv`
    : `${label.padEnd(14)} (absent)`)

if (brief) {
    if (!pre) { console.log(`${tag}: no PRESYNC-BASELINE marker — could not look`); process.exit(2) }
    console.log([
        tag.padEnd(10), `pre ${M(pre[1]).padStart(7)}`,
        `peakWS ${M(peakW[1]).padStart(7)}`, `peakPriv ${M(peakP[2]).padStart(7)}`,
        `settled ${settled ? M(settled[1]).padStart(7) : '   n/a '}`,
        `+60s ${idle60 ? M(idle60[1]).padStart(7) : '   n/a '}`,
        `chunks ${sent}/${decoded}`, `refusals ${refusals}`
    ].join('  '))
    process.exit(0)
}

console.log(`\n===== ${tag}`)
console.log(`samples=${rows.length}  span=${((rows.at(-1)[0] - t0) / 1000).toFixed(0)}s  ` +
    `interval~${Math.round((rows.at(-1)[0] - t0) / rows.length)}ms  ` +
    `chunks sent=${sent} decoded=${decoded} refusals=${refusals}`)
console.log('   t(s)  phase                          WorkingSet   PrivateCommit')
for (const ph of find(/PRESYNC|SYNC-DONE|SETTLED|ROUND-|IDLE-|END|client-registered|KILL|REFUSAL/)) {
    const r = at(ph.ms)
    if (!r) continue
    console.log(`  ${String(((ph.ms - t0) / 1000).toFixed(0)).padStart(5)}  ${ph.p.padEnd(30)} ` +
        `${M(r[1]).padStart(8)} MiB ${M(r[2]).padStart(9)} MiB`)
}
console.log('')
console.log('  ' + row('PRESYNC', pre))
console.log('  ' + row('PEAK(byWS)', peakW) + `   t=${((peakW[0] - t0) / 1000).toFixed(0)}s`)
console.log('  ' + row('PEAK(byPriv)', peakP) + `   t=${((peakP[0] - t0) / 1000).toFixed(0)}s`)
console.log('  ' + row('SETTLED', settled))
console.log('  ' + row('+30s', idle30))
console.log('  ' + row('+60s', idle60))
console.log('  ' + row('LAST', last))
if (pre) {
    console.log(`  climb pre->peak      ${M(peakW[1] - pre[1])} MiB WS   ${M(peakP[2] - pre[2])} MiB priv`)
    console.log(`  retained pre->last   ${M(last[1] - pre[1])} MiB WS   ${M(last[2] - pre[2])} MiB priv`)
}
