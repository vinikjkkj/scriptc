/* modestat.mjs — the within-mode, unpaired comparison, with a permutation null.
 *
 *   node modestat.mjs <pair-log> [...] --runroot <dir> [--control buf] [--treat nobuf]
 *   node modestat.mjs --selftest
 *
 * WHY THIS EXISTS, when memstat.mjs already does the paired comparison.
 *
 * This workload's peak is bimodal (see memstat.mjs). Comparing only within a
 * mode is right, but it interacts badly with pairing: a repetition is usable
 * only when BOTH arms land in the same mode, and at the ~30% per-run incidence
 * measured here that costs a third to two thirds of the repetitions. Worse, on
 * one experiment (`ablive`) every surviving repetition happened to share the
 * same arm ORDER, so the paired tool correctly refused to report at all —
 * rotation is what cancels the position bias, and mode-matching had silently
 * undone it.
 *
 * So this is the fallback, and it is only legitimate because of a fact that
 * has to be checked rather than assumed: WITHIN THE LOW MODE THIS METRIC DOES
 * NOT DRIFT. Measured over 58 runs spanning 200 minutes, low-mode peak working
 * set ran 183.77..184.86 MiB — a total range of 0.59% — with the first run of
 * the session and the last reading the same. Pairing exists to cancel drift;
 * where there is no drift to cancel, an unpaired comparison within one mode is
 * sound and uses every run instead of half of them. `--drift` prints the
 * evidence, and the tool REFUSES if the drift it measures is large enough to
 * make the unpaired statistic unsafe.
 *
 * THE NULL IS A PERMUTATION, NOT AN ASSUMPTION. Rather than compare a median
 * ratio to a floor borrowed from somewhere else, the arm labels are shuffled
 * many times over the same runs. That builds the exact distribution of
 * "median ratios this set of numbers produces when the labels mean nothing",
 * which is the right thing to judge an observed ratio against, needs no
 * normality, and handles unequal group sizes without correction.
 *
 * --selftest checks both directions: labels shuffled on real-shaped data must
 * come back non-significant, and a planted effect must come back significant.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const METRICS = [
    ['peakWS', 'peak working set'],
    ['peakPriv', 'peak private commit'],
    ['settledWS', 'settled working set'],
    ['settledPriv', 'settled private commit'],
]

function readRun(runRoot, tag) {
    const csv = join(runRoot, `${tag}.rss.csv`)
    const phc = join(runRoot, `${tag}.phases.csv`)
    if (!existsSync(csv) || !existsSync(phc)) return null
    const rows = readFileSync(csv, 'utf8').trim().split(/\r?\n/)
        .map((l) => l.split(',').map(Number))
        .filter((r) => r.length >= 3 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && Number.isFinite(r[2]))
    if (!rows.length) return null
    const phases = readFileSync(phc, 'utf8').trim().split(/\r?\n/).slice(1)
        .map((l) => { const i = l.indexOf(','); return { ms: Number(l.slice(0, i)), p: l.slice(i + 1) } })
        .filter((p) => Number.isFinite(p.ms) && p.ms > 0)
    const at = (ms) => { let best = null; for (const r of rows) if (r[0] <= ms + 400) best = r; return best }
    const markRe = (re) => { const p = phases.find((x) => re.test(x.p)); return p ? at(p.ms) : null }
    const peakW = rows.reduce((a, b) => (b[1] > a[1] ? b : a))
    const peakP = rows.reduce((a, b) => (b[2] > a[2] ? b : a))
    const settled = markRe(/^SETTLED-r/) ?? markRe(/^SYNC-DONE/)
    const m = new Map([['peakWS', peakW[1]], ['peakPriv', peakP[2]]])
    if (settled) { m.set('settledWS', settled[1]); m.set('settledPriv', settled[2]) }
    return { metrics: m, startMs: phases.length ? phases[0].ms : 0 }
}

function parsePair(path) {
    const out = []
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^===ARM (\S+) REP (\d+) POS (\d+) TAG (\S+)/)
        if (m) out.push({ arm: m[1], rep: Number(m[2]), pos: Number(m[3]), tag: m[4] })
    }
    return out
}

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b)
    if (!s.length) return null
    const h = s.length >> 1
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}
const MiB = (b) => (b / 1048576).toFixed(2)
const pct = (r) => `${(r - 1) >= 0 ? '+' : ''}${((r - 1) * 100).toFixed(2)}%`

/** Deterministic PRNG, so a reported p-value is reproducible. */
function rng(seed) {
    let s = seed >>> 0
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/** Two-sided permutation test on the ratio of medians. */
function permTest(controlVals, treatVals, iters = 20000, seed = 12345) {
    const nc = controlVals.length, nt = treatVals.length
    if (nc < 2 || nt < 2) return null
    const obs = median(treatVals) / median(controlVals)
    const pool = [...controlVals, ...treatVals]
    const rand = rng(seed)
    let atLeastAsExtreme = 0
    for (let i = 0; i < iters; i++) {
        const p = [...pool]
        for (let j = p.length - 1; j > 0; j--) {
            const k = Math.floor(rand() * (j + 1))
            const t = p[j]; p[j] = p[k]; p[k] = t
        }
        const r = median(p.slice(nc)) / median(p.slice(0, nc))
        if (Math.abs(Math.log(r)) >= Math.abs(Math.log(obs)) - 1e-15) atLeastAsExtreme++
    }
    return { obs, p: (atLeastAsExtreme + 1) / (iters + 1), nc, nt }
}

function modeThreshold(peaks) {
    const s = [...peaks].sort((a, b) => a - b)
    if (s.length < 4) return null
    const gaps = []
    for (let i = 1; i < s.length; i++) gaps.push({ g: s[i] / s[i - 1], at: i })
    gaps.sort((a, b) => b.g - a.g)
    const [best, second] = gaps
    if (best.g < 1.06) return null
    if (second !== undefined && best.g - 1 < 3 * (second.g - 1)) return null
    if (best.at < 2 || s.length - best.at < 2) return null
    return (s[best.at] + s[best.at - 1]) / 2
}

/** Is the low mode stable enough over time for an unpaired test to be sound? */
function driftCheck(runs) {
    const lows = runs.filter((r) => r.mode === 'low').sort((a, b) => a.startMs - b.startMs)
    if (lows.length < 6) return { ok: false, why: 'fewer than 6 low-mode runs — cannot assess drift' }
    const vals = lows.map((r) => r.metrics.get('peakWS'))
    const range = Math.max(...vals) / Math.min(...vals) - 1
    const firstHalf = median(vals.slice(0, Math.floor(vals.length / 2)))
    const secondHalf = median(vals.slice(Math.ceil(vals.length / 2)))
    const halfShift = secondHalf / firstHalf - 1
    /* 2% total range and 1% half-to-half shift are both far above what was
     * measured (0.59% and ~0.0%) and far below the effect sizes that would
     * matter. Beyond them, pairing is doing real work and this tool should
     * not be used. */
    const ok = range < 0.02 && Math.abs(halfShift) < 0.01
    return {
        ok, range, halfShift, n: lows.length,
        spanMin: (lows[lows.length - 1].startMs - lows[0].startMs) / 60000,
        why: ok ? null : `low-mode peak drifts too much (range ${(range * 100).toFixed(2)}%, half-to-half ${(halfShift * 100).toFixed(2)}%) — pairing is needed and this unpaired tool must not be used`,
    }
}

function analyse({ logs, runRoot, controlArm, treatArm, label }) {
    const runs = []
    for (const l of logs) {
        for (const r of parsePair(l)) {
            const d = readRun(runRoot, r.tag)
            if (d) runs.push({ ...r, ...d, log: l })
        }
    }
    if (!runs.length) { console.log(`${label}: no runs — could not look`); return null }
    const thr = modeThreshold(runs.map((r) => r.metrics.get('peakWS')).filter(Number.isFinite))
    for (const r of runs) r.mode = thr === null ? 'single' : (r.metrics.get('peakWS') > thr ? 'HIGH' : 'low')

    console.log(`\n===== ${label}`)
    console.log(`   runs=${runs.length}  mode split at ${thr === null ? 'n/a (unimodal)' : MiB(thr) + ' MiB'}`)
    const inc = (arm) => {
        const a = runs.filter((r) => r.arm === arm)
        return `${a.filter((r) => r.mode === 'HIGH').length}/${a.length}`
    }
    console.log(`   HIGH-mode incidence:  ${controlArm}=${inc(controlArm)}   ${treatArm}=${inc(treatArm)}`)

    const drift = driftCheck(runs)
    console.log(`   drift check: n=${drift.n ?? '?'} low-mode runs over ${drift.spanMin ? drift.spanMin.toFixed(0) : '?'} min, ` +
        `range ${drift.range !== undefined ? (drift.range * 100).toFixed(2) + '%' : 'n/a'}, ` +
        `half-to-half ${drift.halfShift !== undefined ? (drift.halfShift * 100).toFixed(2) + '%' : 'n/a'} — ${drift.ok ? 'STABLE, unpaired test is sound' : 'UNSTABLE'}`)
    if (!drift.ok) { console.log(`   REFUSING: ${drift.why}`); return null }

    const out = []
    for (const [key, what] of METRICS) {
        const c = runs.filter((r) => r.arm === controlArm && r.mode === 'low').map((r) => r.metrics.get(key)).filter(Number.isFinite)
        const t = runs.filter((r) => r.arm === treatArm && r.mode === 'low').map((r) => r.metrics.get(key)).filter(Number.isFinite)
        const res = permTest(c, t)
        if (res === null) { console.log(`   ${key.padEnd(12)} too few low-mode runs (${c.length} vs ${t.length}) — n/a, not 0`); continue }
        const verdict = res.p < 0.05 ? (res.obs < 1 ? `${treatArm} LOWER` : `${treatArm} HIGHER`) : 'DRAW'
        console.log(`   ${key.padEnd(12)} ${pct(res.obs).padStart(8)}  ` +
            `${MiB(median(c)).padStart(7)} -> ${MiB(median(t)).padStart(7)} MiB  ` +
            `n=${res.nc}v${res.nt}  p=${res.p.toFixed(4)}  ${verdict}   ${what}`)
        out.push([key, verdict, res])
    }
    return out
}

/* ── self-test ─────────────────────────────────────────────────────────── */
function selftest() {
    console.log('modestat --selftest\n')
    let bad = 0

    /* 1. labels mean nothing -> must NOT be significant */
    const base = Array.from({ length: 14 }, (_, i) => 184 + (i % 5) * 0.2)
    const a = base.filter((_, i) => i % 2 === 0), b = base.filter((_, i) => i % 2 === 1)
    const nullRes = permTest(a, b)
    console.log(`  null case:    ${pct(nullRes.obs)} p=${nullRes.p.toFixed(4)}  ${nullRes.p < 0.05 ? 'SIGNIFICANT (WRONG)' : 'not significant (correct)'}`)
    if (nullRes.p < 0.05) { console.log('  SELFTEST FAILED: shuffled labels came back significant'); bad++ }

    /* 2. a planted 5% -> must BE significant. 5% is an order below the mode
     * step and an order above the within-mode spread, i.e. the smallest thing
     * this test is being asked to find. */
    const c2 = Array.from({ length: 7 }, (_, i) => 184 + (i % 5) * 0.2)
    const t2 = c2.map((v) => v * 0.95)
    const effRes = permTest(c2, t2)
    console.log(`  planted -5%:  ${pct(effRes.obs)} p=${effRes.p.toFixed(4)}  ${effRes.p < 0.05 ? 'significant (correct)' : 'NOT SIGNIFICANT (WRONG)'}`)
    if (effRes.p >= 0.05) { console.log('  SELFTEST FAILED: a planted 5% was not detected'); bad++ }

    /* 3. the drift guard must refuse a drifting series */
    const drifting = Array.from({ length: 12 }, (_, i) => ({
        mode: 'low', startMs: i * 60000, metrics: new Map([['peakWS', 184 * (1 + i * 0.01)]]),
    }))
    const d = driftCheck(drifting)
    console.log(`  drift guard:  range ${(d.range * 100).toFixed(1)}% -> ${d.ok ? 'ACCEPTED (WRONG)' : 'refused (correct)'}`)
    if (d.ok) { console.log('  SELFTEST FAILED: the drift guard accepted an 11% drift'); bad++ }

    console.log('')
    if (bad) { console.log(`SELFTEST FAILED (${bad})`); process.exit(1) }
    console.log('SELFTEST PASSED: shuffled labels are null, a planted 5% is found, drift is refused.')
}

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) { selftest(); process.exit(0) }
const ri = argv.indexOf('--runroot')
const runRoot = ri === -1 ? (process.env.MEMRIG_OUT ?? '.') : resolve(argv[ri + 1])
const ci = argv.indexOf('--control'), ti = argv.indexOf('--treat')
const li = argv.indexOf('--label')
const logs = argv.filter((x, i) => !x.startsWith('--') && argv[i - 1] !== '--runroot'
    && argv[i - 1] !== '--control' && argv[i - 1] !== '--treat' && argv[i - 1] !== '--label').map((x) => resolve(x))
if (!logs.length) { console.log('usage: node modestat.mjs <pair-log> [...] --runroot <dir>'); process.exit(2) }
analyse({
    logs, runRoot,
    controlArm: ci === -1 ? 'buf' : argv[ci + 1],
    treatArm: ti === -1 ? 'nobuf' : argv[ti + 1],
    label: li === -1 ? logs.map((l) => l.replace(/.*[\\/]/, '')).join(' + ') : argv[li + 1],
})
