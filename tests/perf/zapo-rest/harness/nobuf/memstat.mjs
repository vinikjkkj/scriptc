/* memstat.mjs — turn a pair.sh log into paired memory ratios with a stated floor.
 *
 *   node memstat.mjs <pair-log> [--floor <aa-log> ...] [--runroot <dir>]
 *   node memstat.mjs --selftest
 *
 * THE RULES THIS ENCODES, so they cannot be forgotten in a hurry. They are the
 * rules tests/perf/clientbench/harness/benchstat.mjs encodes for timing, applied
 * to the memrig's kernel-side memory series.
 *
 *  1. A ratio is only ever formed between the two arms of the SAME repetition.
 *     The host drifts run to run; an across-rep ratio is not a measurement.
 *
 *  2. ARM ORDER ROTATES PER REPETITION, and this tool checks that it did. A
 *     previous block on this project found a POSITION-DEPENDENT BIAS that its
 *     paired design did not cancel — the arm that ran second won one metric 6
 *     of 6 times, sign test p = 0.031. Pairing alone does not remove it;
 *     rotation does. So this tool refuses a log whose arm order never changed,
 *     and prints the by-position medians beside the pooled one so a residual
 *     position effect stays visible instead of being averaged into the answer.
 *
 *  3. The reported value is the MEDIAN of the per-rep ratios with the full
 *     [min .. max] beside it. A median without its spread is a claim without an
 *     error bar.
 *
 *  4. A FLOOR IS A DRAW, NOT A VALUE. --floor takes A/A logs (the same binary
 *     with the same knobs as both arms). EVERY A/A repetition from EVERY floor
 *     log is pooled, the pooled count is printed, and the floor for a metric is
 *     the largest |ratio - 1| in that pool. `max|r-1| over four repetitions` is
 *     not a bound: two consecutive A/A runs of the same binary have read ±0.80%
 *     and ±8.30% on one metric on this host. Anything inside the floor prints
 *     DRAW. Without --floor nothing is called a difference at all.
 *
 *  5. A null result is a result. DRAW is printed as an answer, not as a
 *     failure to find one.
 *
 * --selftest runs rule 4 against itself: it fabricates an A/A pair carrying the
 * host drift the real one has and asserts this tool reports NO DIFFERENCE on
 * every metric. A comparison harness that cannot produce a null result has not
 * been shown to be able to produce a true one.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'

/* ── the metrics, defined exactly as memrig-report.mjs defines them ─────── */

const METRICS = [
    ['peakWS', 'peak working set'],
    ['peakPriv', 'peak private commit'],
    ['settledWS', 'settled working set'],
    ['settledPriv', 'settled private commit'],
    ['idle60WS', 'working set at +60s idle'],
    ['presyncWS', 'baseline before any history'],
    ['retainedWS', 'settled working set minus its own presync baseline'],
]

/** Read one memrig run's artefacts into {metric -> bytes}. Missing metrics stay
 * ABSENT. They are never 0: a zero here would be averaged as a real reading. */
function readRun(runRoot, tag) {
    const csv = join(runRoot, `${tag}.rss.csv`)
    const phc = join(runRoot, `${tag}.phases.csv`)
    if (!existsSync(csv) || !existsSync(phc)) return { tag, missing: true, metrics: new Map() }
    const rows = readFileSync(csv, 'utf8').trim().split(/\r?\n/)
        .map((l) => l.split(',').map(Number))
        .filter((r) => r.length >= 3 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && Number.isFinite(r[2]))
    if (!rows.length) return { tag, missing: true, reason: '0 samples', metrics: new Map() }
    const phases = readFileSync(phc, 'utf8').trim().split(/\r?\n/).slice(1)
        .map((l) => { const i = l.indexOf(','); return { ms: Number(l.slice(0, i)), p: l.slice(i + 1) } })
        .filter((p) => Number.isFinite(p.ms) && p.ms > 0)

    const at = (ms) => { let best = null; for (const r of rows) if (r[0] <= ms + 400) best = r; return best }
    const mark = (name) => { const p = phases.find((x) => x.p === name); return p ? at(p.ms) : null }
    const markRe = (re) => { const p = phases.find((x) => re.test(x.p)); return p ? at(p.ms) : null }

    const pre = mark('PRESYNC-BASELINE')
    const peakW = rows.reduce((a, b) => (b[1] > a[1] ? b : a))
    const peakP = rows.reduce((a, b) => (b[2] > a[2] ? b : a))
    const settled = markRe(/^SETTLED-r/) ?? markRe(/^SYNC-DONE/)
    const idle60 = mark('IDLE-60s')

    const m = new Map()
    m.set('peakWS', peakW[1]); m.set('peakPriv', peakP[2])
    if (settled) { m.set('settledWS', settled[1]); m.set('settledPriv', settled[2]) }
    if (idle60) m.set('idle60WS', idle60[1])
    if (pre) m.set('presyncWS', pre[1])
    if (pre && settled) m.set('retainedWS', settled[1] - pre[1])

    /* Health facts a memory number must be read beside. A run that refused, or
     * whose subscriber received nothing, is not a memory result. */
    const health = {
        samples: rows.length,
        refusals: phases.filter((p) => /REFUSAL/.test(p.p)).length,
        chunksSent: phases.filter((p) => /^chunk-sent-/.test(p.p)).length,
        chunksDecoded: phases.filter((p) => /^chunk-decoded-/.test(p.p)).length,
        cleanExit: phases.some((p) => /^clean-exit/.test(p.p)),
        fallbackKill: phases.some((p) => /shutdown-fallback-kill/.test(p.p)),
        ws: phases.find((p) => /^ws-frames=/.test(p.p))?.p ?? null,
        wsNothing: phases.some((p) => /ws-DELIVERED-NOTHING/.test(p.p)),
        ringDisabled: phases.some((p) => /^events-ring-disabled/.test(p.p)),
        liveDrained: phases.find((p) => /^LIVE-DRAINED/.test(p.p))?.p ?? null,
        arms: phases.length === 0 ? [] : [],
    }
    const armLines = readFileSync(phc, 'utf8').trim().split(/\r?\n/)
        .filter((l) => l.startsWith('0,ARM ')).map((l) => l.slice(6))
    health.arms = armLines
    return { tag, missing: false, metrics: m, health }
}

/* ── parsing a pair.sh log ─────────────────────────────────────────────── */

function parsePair(path) {
    const text = readFileSync(path, 'utf8')
    const lines = text.split(/\r?\n/)
    const header = lines.filter((l) => l.startsWith('###'))
    const runs = []
    for (const line of lines) {
        // ===ARM <label> REP <n> POS <1|2> TAG <tag> exe=<...> knobs=<...>
        const m = line.match(/^===ARM (\S+) REP (\d+) POS (\d+) TAG (\S+)/)
        if (m) runs.push({ arm: m[1], rep: Number(m[2]), pos: Number(m[3]), tag: m[4], rc: null })
        const x = line.match(/^===ARMEXIT (\S+) REP (\d+) rc=(\d+)/)
        if (x) {
            const r = runs.find((q) => q.arm === x[1] && q.rep === Number(x[2]) && q.rc === null)
            if (r) r.rc = Number(x[3])
        }
    }
    return { header, runs, path }
}

/* ── PEAK MODES ─────────────────────────────────────────────────────────
 *
 * This workload's peak is BIMODAL, and treating that as noise is the single
 * biggest way to get a wrong answer out of it.
 *
 * Measured here over 14 A/A runs -- the SAME binary, the same knobs:
 *
 *     11 runs   183.77 .. 184.68 MiB     spread 0.91 MiB  (0.5%)
 *      3 runs   210.57 .. 214.35 MiB
 *      nothing in between
 *
 * The step is +14% working set and +19% private commit, and it is DISCRETE:
 * a run either takes it or it does not. Commit going UP by ~140 MiB rules out
 * OS working-set trimming, which would push resident pages down and leave
 * commit alone -- this is the program choosing a different allocation path,
 * not the host leaning on it. An earlier block on this rig saw the same thing
 * from the other side and called them "peak modes" (~211 vs ~186 MiB),
 * excluding off-mode singletons by hand.
 *
 * Pooling both modes into one `max|r-1|` produced a +/-12.63% "floor", and
 * then reported a +16.23% difference between two arms THAT WERE THE SAME
 * EXECUTABLE. Both numbers are artefacts of averaging across a mode switch.
 * Within the low mode the spread is 0.91 MiB -- which is the 0.92 MiB A/A
 * floor this rig recorded historically, so the instrument is fine and it was
 * the statistic that was wrong.
 *
 * So: classify every run, compare only WITHIN a mode, and report the mode
 * incidence per arm as a result in its own right -- if a change makes the
 * expensive mode more or less likely, that is a real effect and it would be
 * invisible in a median.
 */

/** Split runs into modes on the largest relative gap in peak working set.
 * Returns a threshold, or null when the runs are unimodal. */
function modeThreshold(peaks) {
    const s = [...peaks].sort((a, b) => a - b)
    if (s.length < 4) return null
    const gaps = []
    for (let i = 1; i < s.length; i++) gaps.push({ g: s[i] / s[i - 1], at: i })
    gaps.sort((a, b) => b.g - a.g)
    const best = gaps[0], second = gaps[1]
    /* TWO conditions, and the second one is the one that matters.
     *
     * A bare "gap > 6%" threshold is not enough, and the self-test proved it:
     * fed an A/A series carrying 8% continuous host drift, it found a 6% gap
     * between two adjacent samples, declared two modes, and excluded every
     * repetition -- turning a clean null into "nothing to compare". Drift is
     * a spread of similar gaps; a mode is ONE gap that dwarfs the rest.
     *
     * So the largest gap must also be at least 3x the next largest. On the
     * real data that is 14% against ~0.3% (a factor of ~45). On drift, every
     * gap is comparable and nothing splits. */
    if (best.g < 1.06) return null
    if (second !== undefined && best.g - 1 < 3 * (second.g - 1)) return null
    /* THIRD: both sides must be populated. A "mode" with one member is an
     * outlier, and excluding every repetition that does not share it would
     * throw away the measurement to accommodate a single run. The real split
     * is 11 against 3; the self-test's lone -8.3% sample is 1 against 7 and
     * must stay in the pool where it widens the floor honestly. */
    const nLow = best.at, nHigh = s.length - best.at
    if (nLow < 2 || nHigh < 2) return null
    return (s[best.at] + s[best.at - 1]) / 2
}

const modeOf = (run, thr) => {
    const p = run.metrics.get('peakWS')
    if (thr === null || typeof p !== 'number') return 'single'
    return p > thr ? 'HIGH' : 'low'
}

/** Per-rep ratios treatment/control for one log. */
function ratios(parsed, runRoot, controlArm, treatArm, thr = null) {
    const byRep = new Map()
    for (const r of parsed.runs) {
        if (!byRep.has(r.rep)) byRep.set(r.rep, {})
        byRep.get(r.rep)[r.arm] = { ...r, ...readRun(runRoot, r.tag) }
    }
    const out = []
    for (const [rep, arms] of [...byRep.entries()].sort((a, b) => a[0] - b[0])) {
        const c = arms[controlArm], t = arms[treatArm]
        if (!c || !t) continue
        const per = new Map()
        for (const [key] of METRICS) {
            const cv = c.metrics.get(key), tv = t.metrics.get(key)
            if (typeof cv === 'number' && typeof tv === 'number' && cv !== 0) per.set(key, tv / cv)
        }
        const cMode = modeOf(c, thr), tMode = modeOf(t, thr)
        out.push({
            rep, control: c, treat: t, per, treatPos: t.pos,
            cMode, tMode, modeMatched: cMode === tMode,
        })
    }
    return out
}

/** Every run mentioned by these logs, for the global mode split. */
function allPeaks(logs, runRoot) {
    /* DEDUPED BY TAG. An A/A log is routinely passed as both the measurement
     * and its own floor, which counted every run twice and let a lone outlier
     * reach the two-member minimum below and masquerade as a mode. The
     * self-test caught it. A run is one observation however many times its
     * log is named. */
    const seen = new Set()
    const peaks = []
    for (const l of logs) {
        for (const r of parsePair(l).runs) {
            if (seen.has(r.tag)) continue
            seen.add(r.tag)
            const p = readRun(runRoot, r.tag).metrics.get('peakWS')
            if (typeof p === 'number') peaks.push(p)
        }
    }
    return peaks
}

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b)
    if (!s.length) return null
    const h = s.length >> 1
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}
const MiB = (b) => (b / 1048576).toFixed(2)
const pct = (r) => `${((r - 1) * 100 >= 0 ? '+' : '')}${((r - 1) * 100).toFixed(2)}%`

/* ── the report ────────────────────────────────────────────────────────── */

function report({ pairLog, floorLogs, runRoot, controlArm, treatArm }) {
    const parsed = parsePair(pairLog)
    /* One split for every log in play, so a rep in the A/B and a rep in the
     * floor are classified by the same rule. */
    const thr = modeThreshold(allPeaks([pairLog, ...floorLogs], runRoot))
    const repsAll = ratios(parsed, runRoot, controlArm, treatArm, thr)
    const reps = thr === null ? repsAll : repsAll.filter((r) => r.modeMatched)

    console.log(`\n===== memstat  ${pairLog}`)
    for (const h of parsed.header) console.log(h)
    console.log(`control=${controlArm}  treatment=${treatArm}  reps=${reps.length}  runRoot=${runRoot}`)

    /* ── the mode report, before any ratio ──────────────────────────── */
    if (thr === null) {
        console.log(`\n-- peak modes: UNIMODAL (no gap above 6% in peak working set) --`)
    } else {
        console.log(`\n-- peak modes: BIMODAL, split at ${MiB(thr)} MiB peak working set --`)
        const inc = new Map()
        for (const r of repsAll) {
            for (const [arm, run] of [[controlArm, r.control], [treatArm, r.treat]]) {
                const k = `${arm}:${modeOf(run, thr)}`
                inc.set(k, (inc.get(k) ?? 0) + 1)
            }
        }
        for (const arm of [controlArm, treatArm]) {
            const lo = inc.get(`${arm}:low`) ?? 0, hi = inc.get(`${arm}:HIGH`) ?? 0
            console.log(`   ${arm.padEnd(7)} low=${lo}  HIGH=${hi}  (the HIGH mode is ~+14% WS, ~+19% commit, and DISCRETE)`)
        }
        const split = repsAll.filter((r) => !r.modeMatched)
        if (split.length) {
            console.log(`   ${split.length} of ${repsAll.length} repetition(s) had the two arms in DIFFERENT modes and are`)
            console.log(`   EXCLUDED from every ratio below — such a pair measures the mode, not the arm:`)
            for (const r of split) console.log(`     rep ${r.rep}: ${controlArm}=${r.cMode} ${treatArm}=${r.tMode}`)
        } else {
            console.log(`   every repetition had both arms in the same mode; none excluded`)
        }
        console.log(`   MODE INCIDENCE IS ITSELF A RESULT: if one arm takes the expensive mode more`)
        console.log(`   often, that is a real effect and no median would show it.`)
    }

    if (!reps.length) {
        console.log('NO PAIRED REPETITIONS — nothing to compare. This is a failure to measure, not a draw.')
        process.exitCode = 2
        return
    }

    /* rule 2: the order must actually have rotated */
    const positions = new Set(reps.map((r) => r.treatPos))
    console.log(`\n-- arm order --`)
    for (const r of reps) console.log(`  rep ${r.rep}: first=${r.treatPos === 1 ? treatArm : controlArm}  second=${r.treatPos === 1 ? controlArm : treatArm}`)
    if (positions.size < 2) {
        console.log(`  ROTATION MISSING: ${treatArm} ran in position ${[...positions][0]} in every repetition.`)
        console.log(`  A position-dependent bias measured on this host is NOT cancelled by pairing alone.`)
        console.log(`  Refusing to report a difference from this log.`)
        process.exitCode = 3
        return
    }
    console.log(`  rotation present (${treatArm} ran first in ${reps.filter((r) => r.treatPos === 1).length} of ${reps.length} reps)`)

    /* health */
    console.log(`\n-- run health (a memory number from an unhealthy run is not a result) --`)
    let unhealthy = 0
    for (const r of reps) {
        for (const [label, run] of [[controlArm, r.control], [treatArm, r.treat]]) {
            const h = run.health
            if (run.missing) { console.log(`  rep ${r.rep} ${label}: MISSING ARTEFACTS (${run.reason ?? 'no csv'})`); unhealthy++; continue }
            const flags = []
            if (run.rc !== 0) flags.push(`rc=${run.rc}`)
            if (h.refusals) flags.push(`refusals=${h.refusals}`)
            if (h.fallbackKill) flags.push('FALLBACK-KILL')
            if (!h.cleanExit) flags.push('no-clean-exit')
            if (h.wsNothing) flags.push('WS-DELIVERED-NOTHING')
            if (h.chunksSent !== h.chunksDecoded) flags.push(`chunks ${h.chunksDecoded}/${h.chunksSent}`)
            if (flags.length) unhealthy++
            console.log(`  rep ${r.rep} ${label.padEnd(7)}: samples=${h.samples} chunks=${h.chunksDecoded}/${h.chunksSent} ` +
                `${h.ringDisabled ? 'ring=disabled ' : ''}${h.ws ?? 'ws=n/a'}${flags.length ? '  [' + flags.join(' ') + ']' : ''}`)
        }
    }
    if (unhealthy) console.log(`  ${unhealthy} run(s) carry a flag — read every number below beside that.`)

    /* the floor */
    const floor = new Map()
    let floorN = 0
    const floorSamples = new Map()
    for (const fl of floorLogs) {
        const fp = parsePair(fl)
        const frAll = ratios(fp, runRoot, controlArm, treatArm, thr)
        const fr = thr === null ? frAll : frAll.filter((r) => r.modeMatched)
        floorN += fr.length
        for (const r of fr) for (const [k, v] of r.per) {
            if (!floorSamples.has(k)) floorSamples.set(k, [])
            floorSamples.get(k).push(v)
        }
    }
    for (const [k, vs] of floorSamples) floor.set(k, Math.max(...vs.map((v) => Math.abs(v - 1))))

    if (floorLogs.length) {
        console.log(`\n-- the floor: ${floorN} pooled A/A repetition(s) from ${floorLogs.length} log(s) --`)
        console.log(`   (an A/A pair is the SAME binary with the SAME knobs on both arms; every`)
        console.log(`    repetition of every such log is pooled, and the floor is the LARGEST`)
        console.log(`    |ratio-1| in the pool. max|r-1| over four reps is not a bound.)`)
        for (const [key, what] of METRICS) {
            const vs = floorSamples.get(key)
            if (!vs) { console.log(`  ${key.padEnd(13)} floor n/a (absent from every A/A rep)`); continue }
            console.log(`  ${key.padEnd(13)} floor +/-${(floor.get(key) * 100).toFixed(2)}%  n=${vs.length}  ` +
                `[${vs.map((v) => pct(v)).join(' ')}]   ${what}`)
        }
    } else {
        console.log(`\n-- NO FLOOR GIVEN --`)
        console.log(`   Ratios are printed below; NOTHING is called a difference. A delta without`)
        console.log(`   a floor cannot be distinguished from this host's own noise.`)
    }

    /* the answer */
    console.log(`\n-- ${treatArm} vs ${controlArm}, per-rep ratios (>1 means ${treatArm} used MORE) --`)
    const verdicts = []
    for (const [key, what] of METRICS) {
        const vals = reps.map((r) => r.per.get(key)).filter((v) => typeof v === 'number')
        if (!vals.length) { console.log(`  ${key.padEnd(13)} absent from every repetition — n/a, not 0`); continue }
        const med = median(vals)
        const lo = Math.min(...vals), hi = Math.max(...vals)
        const f = floor.get(key)
        let verdict
        if (f === undefined) verdict = 'FLOOR UNKNOWN'
        else if (Math.abs(med - 1) <= f) verdict = 'DRAW'
        else verdict = med < 1 ? `${treatArm} LOWER` : `${treatArm} HIGHER`
        verdicts.push([key, verdict, med, f])

        /* absolute medians, because a ratio hides the size of the thing */
        const cAbs = median(reps.map((r) => r.control.metrics.get(key)).filter((v) => typeof v === 'number'))
        const tAbs = median(reps.map((r) => r.treat.metrics.get(key)).filter((v) => typeof v === 'number'))
        console.log(`  ${key.padEnd(13)} median ${pct(med).padStart(8)}  [${pct(lo)} .. ${pct(hi)}]  ` +
            `${MiB(cAbs).padStart(8)} -> ${MiB(tAbs).padStart(8)} MiB  ${verdict}`)

        /* rule 2's residual: by position */
        const first = reps.filter((r) => r.treatPos === 1).map((r) => r.per.get(key)).filter(Number.isFinite)
        const second = reps.filter((r) => r.treatPos === 2).map((r) => r.per.get(key)).filter(Number.isFinite)
        if (first.length && second.length) {
            console.log(`  ${''.padEnd(13)}   by position: ${treatArm} first ${pct(median(first))} (n=${first.length}), ` +
                `second ${pct(median(second))} (n=${second.length})   ${what}`)
        }
    }

    console.log(`\n-- verdict --`)
    const real = verdicts.filter(([, v]) => v !== 'DRAW' && v !== 'FLOOR UNKNOWN')
    if (!floorLogs.length) console.log('  FLOOR UNKNOWN — no claim is made.')
    else if (!real.length) {
        console.log(`  DRAW on every metric. Every difference between ${treatArm} and ${controlArm} is`)
        console.log(`  smaller than this host's own A/A floor. That is a result, not a missing one.`)
    } else {
        for (const [key, v, med, f] of real) {
            console.log(`  ${key}: ${v}, median ${pct(med)} against a +/-${(f * 100).toFixed(2)}% floor`)
        }
    }
    return verdicts
}

/* ── self-test ─────────────────────────────────────────────────────────── */

function selftest() {
    console.log('memstat --selftest: fabricating an A/A pair with real host drift\n')
    const root = join(tmpdir(), `memstat-selftest-${process.pid}`)
    rmSync(root, { recursive: true, force: true })
    mkdirSync(root, { recursive: true })

    /* Two arms of the SAME imaginary binary. The only thing separating them is
     * host drift, applied PER REPETITION so it lands on both arms of a rep
     * unequally, exactly as it does in a real run. The drift figures are the
     * ones measured on this host: two consecutive A/A runs read +0.80% and
     * +8.30% on one metric. */
    const drift = [
        { a: 1.000, b: 1.008 },
        { a: 1.000, b: 0.917 },
        { a: 1.030, b: 1.000 },
        { a: 1.000, b: 1.061 },
    ]
    const base = { peak: 195 * 1048576, settled: 104 * 1048576, pre: 41 * 1048576 }
    const lines = ['### SELFTEST A/A']
    drift.forEach((d, i) => {
        const rep = i + 1
        /* rotation, as the real runner does it */
        const order = rep % 2 === 1 ? ['ctl', 'trt'] : ['trt', 'ctl']
        order.forEach((arm, idx) => {
            const tag = `st-r${rep}-${arm}`
            const k = arm === 'ctl' ? d.a : d.b
            const t0 = 1700000000000
            const rows = ['ms,workingSet,privateCommit,pageFaults,cpuMs']
            /* a series whose max is the peak and whose value at the SETTLED
             * marker is the settled figure */
            rows.push(`${t0},${Math.round(base.pre * k)},${Math.round(base.pre * k * 3)},0,0`)
            rows.push(`${t0 + 1000},${Math.round(base.peak * k)},${Math.round(base.peak * k * 3)},0,0`)
            rows.push(`${t0 + 2000},${Math.round(base.settled * k)},${Math.round(base.settled * k * 3)},0,0`)
            rows.push(`${t0 + 3000},${Math.round(base.settled * k)},${Math.round(base.settled * k * 3)},0,0`)
            writeFileSync(join(root, `${tag}.rss.csv`), rows.join('\n') + '\n')
            writeFileSync(join(root, `${tag}.phases.csv`),
                `ms,phase\n${t0},PRESYNC-BASELINE\n${t0 + 2000},SETTLED-r1\n${t0 + 3000},IDLE-60s\n${t0 + 3000},clean-exit code=0\n`)
            lines.push(`===ARM ${arm} REP ${rep} POS ${idx + 1} TAG ${tag} exe=selftest knobs=none`)
            lines.push(`===ARMEXIT ${arm} REP ${rep} rc=0`)
        })
    })
    const log = join(root, 'aa.log')
    writeFileSync(log, lines.join('\n') + '\n')

    /* The SAME log is both the measurement and its own floor: an A/A pair
     * scored against itself must come back DRAW on every metric. If this tool
     * can report a difference here, it can report one anywhere. */
    const verdicts = report({ pairLog: log, floorLogs: [log], runRoot: root, controlArm: 'ctl', treatArm: 'trt' })
    const bad = (verdicts ?? []).filter(([, v]) => v !== 'DRAW')
    console.log('')
    if (bad.length) {
        console.log(`SELFTEST FAILED: ${bad.length} metric(s) called a difference on an A/A pair:`)
        for (const [k, v] of bad) console.log(`  ${k}: ${v}`)
        process.exit(1)
    }
    console.log('PHASE 1 PASSED: an A/A pair carrying real host drift reports DRAW on every metric.')

    /* PHASE 2 — the other half, and it is not optional.
     *
     * Phase 1 only shows the tool can say DRAW. A tool that says DRAW to
     * EVERYTHING would pass it, and would then say DRAW to the real A/B and
     * look like a result. So: keep the same floor, and feed it a treatment
     * arm moved by 25% — far outside the +/-8.30% floor above. It must call
     * that a difference, and it must call it in the right direction. */
    console.log('\nmemstat --selftest phase 2: the same floor, a treatment moved 25% DOWN\n')
    const lines2 = ['### SELFTEST A/B (planted -25% on the treatment arm)']
    drift.forEach((d, i) => {
        const rep = i + 1
        const order = rep % 2 === 1 ? ['ctl', 'trt'] : ['trt', 'ctl']
        order.forEach((arm, idx) => {
            const tag = `ab-r${rep}-${arm}`
            const k = (arm === 'ctl' ? d.a : d.b) * (arm === 'trt' ? 0.75 : 1)
            const t0 = 1700000000000
            const rows = ['ms,workingSet,privateCommit,pageFaults,cpuMs']
            rows.push(`${t0},${Math.round(base.pre * k)},${Math.round(base.pre * k * 3)},0,0`)
            rows.push(`${t0 + 1000},${Math.round(base.peak * k)},${Math.round(base.peak * k * 3)},0,0`)
            rows.push(`${t0 + 2000},${Math.round(base.settled * k)},${Math.round(base.settled * k * 3)},0,0`)
            rows.push(`${t0 + 3000},${Math.round(base.settled * k)},${Math.round(base.settled * k * 3)},0,0`)
            writeFileSync(join(root, `${tag}.rss.csv`), rows.join('\n') + '\n')
            writeFileSync(join(root, `${tag}.phases.csv`),
                `ms,phase\n${t0},PRESYNC-BASELINE\n${t0 + 2000},SETTLED-r1\n${t0 + 3000},IDLE-60s\n${t0 + 3000},clean-exit code=0\n`)
            lines2.push(`===ARM ${arm} REP ${rep} POS ${idx + 1} TAG ${tag} exe=selftest knobs=none`)
            lines2.push(`===ARMEXIT ${arm} REP ${rep} rc=0`)
        })
    })
    const log2 = join(root, 'ab.log')
    writeFileSync(log2, lines2.join('\n') + '\n')
    const v2 = report({ pairLog: log2, floorLogs: [log], runRoot: root, controlArm: 'ctl', treatArm: 'trt' })
    const missed = (v2 ?? []).filter(([, v]) => v !== 'trt LOWER')
    console.log('')
    if (missed.length) {
        console.log(`SELFTEST FAILED (phase 2): ${missed.length} metric(s) did not report the planted -25%:`)
        for (const [k, v] of missed) console.log(`  ${k}: ${v}`)
        process.exit(1)
    }
    console.log('PHASE 2 PASSED: a planted -25% is reported as a difference, in the right direction,')
    console.log('  on every metric, against the same floor that returned DRAW in phase 1.')
    console.log('\nSELFTEST PASSED: the tool can produce a null result AND a true one.')
    rmSync(root, { recursive: true, force: true })
}

/* ── cli ───────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) { selftest(); process.exit(0) }

const pairLog = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--floor'
    && argv[argv.indexOf(a) - 1] !== '--runroot' && argv[argv.indexOf(a) - 1] !== '--control'
    && argv[argv.indexOf(a) - 1] !== '--treat')
if (!pairLog) {
    console.log('usage: node memstat.mjs <pair-log> [--floor <aa-log>]... [--runroot <dir>] [--control A] [--treat B]')
    console.log('       node memstat.mjs --selftest')
    process.exit(2)
}
const floorLogs = []
for (let i = 0; i < argv.length; i++) if (argv[i] === '--floor') floorLogs.push(resolve(argv[++i]))
const ri = argv.indexOf('--runroot')
const runRoot = ri === -1 ? (process.env.MEMRIG_OUT ?? dirname(resolve(pairLog))) : resolve(argv[ri + 1])
const ci = argv.indexOf('--control'), ti = argv.indexOf('--treat')
report({
    pairLog: resolve(pairLog),
    floorLogs,
    runRoot,
    controlArm: ci === -1 ? 'buf' : argv[ci + 1],
    treatArm: ti === -1 ? 'nobuf' : argv[ti + 1],
})
