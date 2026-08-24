/**
 * ab-reanalyze.mjs - re-derive the floor from an ab-strpool.mjs --json file
 * under estimators it did not use, WITHOUT re-running the benchmark.
 *
 * ab-strpool records `raw`, which is every individual sample in acquisition
 * order, and its arms alternate: a0 b0 a1 b1 ... So the file already
 * contains enough to answer three questions the printed report cannot:
 *
 *   1. WOULD A DIFFERENT ESTIMATOR HAVE RESOLVED?  The report divides the
 *      median of arm A by the median of arm B, which throws away the
 *      pairing that alternating the arms created in the first place. This
 *      recomputes the paired median ratio, the ratio of minima, and a
 *      trimmed mean over the same samples.
 *
 *   2. DID INTERLEAVING EARN THE 0.1% RSS FLOOR?  The claim in circulation
 *      is that peak RSS resolves to a tenth of a percent BECAUSE the arms
 *      are interleaved. That is testable offline: relabel the same samples
 *      as a BLOCKED design - first half of the acquisition sequence is arm
 *      A', second half is arm B' - and see whether the RSS floor survives.
 *      If it does, interleaving is not what made RSS resolve, peak RSS is
 *      simply a monotone high-water mark of a deterministic allocation
 *      sequence over fixed work and close to a constant of the program.
 *      Whichever way it falls, it is measured rather than asserted.
 *
 *   3. HOW MUCH OF THE CPU FLOOR IS THE COUNTER RATHER THAN THE HOST?
 *      process.cpuUsage() is GetProcessTimes, which charges whole 15.625 ms
 *      scheduler ticks. This reports what fraction of the cpu samples in
 *      the file are exact multiples of one tick (they all should be), how
 *      many DISTINCT tick counts a scenario produced across its runs, and
 *      what one tick is worth as a percentage of the median. When the
 *      distinct-value count is small, the "floor" is largely the counter's
 *      granularity wearing the clothes of machine noise.
 *
 *   node tests/perf/ab-reanalyze.mjs before/a1-timeboxed.json [more.json ...]
 */
import { readFileSync } from 'node:fs'

const TICK_MS = 15.625 // Windows scheduler tick on this host, measured

const sorted = (v) => [...v].sort((a, b) => a - b)
function median(v) {
  const s = sorted(v)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function trimmedMean(v, frac = 0.2) {
  const s = sorted(v)
  const k = Math.floor(s.length * frac)
  const t = s.slice(k, s.length - k)
  const use = t.length ? t : s
  return use.reduce((a, b) => a + b, 0) / use.length
}
const spreadPct = (v) => { const m = median(v); return m > 0 ? ((Math.max(...v) - Math.min(...v)) / m) * 100 : 0 }

function ests(a, b) {
  const n = Math.min(a.length, b.length)
  const pr = []
  for (let i = 0; i < n; i++) if (a[i] > 0) pr.push(b[i] / a[i])
  const ma = median(a), mb = median(b)
  return {
    pairedMedian: pr.length ? median(pr) : NaN,
    medians: ma > 0 ? mb / ma : NaN,
    mins: Math.min(...a) > 0 ? Math.min(...b) / Math.min(...a) : NaN,
    trimmed: trimmedMean(a) > 0 ? trimmedMean(b) / trimmedMean(a) : NaN,
    spreadA: spreadPct(a), spreadB: spreadPct(b)
  }
}

/* Relabel an interleaved acquisition a0 b0 a1 b1 ... as a BLOCKED one:
 * the first half of the time-ordered sequence becomes arm A', the second
 * half arm B'. Same samples, same host, same binary - only the DESIGN
 * changes, which is exactly the variable the interleaving claim is about. */
function blocked(a, b) {
  const seq = []
  for (let i = 0; i < Math.min(a.length, b.length); i++) { seq.push(a[i]); seq.push(b[i]) }
  const h = seq.length >> 1
  return [seq.slice(0, h), seq.slice(h)]
}

const pad = (s, n) => String(s).padEnd(n)
const pc = (r) => Number.isFinite(r) ? ((r - 1) * 100).toFixed(3) + '%' : 'n/a'

function report(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'))
  console.log('='.repeat(104))
  console.log(file + '   bench=' + j.bench + ' runs=' + j.runs + ' minMs=' + j.minMs +
    ' only=' + (j.only ?? '(all)') + ' aa=' + j.aa + '   fixedWork=' + j.fixedWork)
  console.log('  host at start: cpu ' + j.machine?.before?.cpuLoadPercent + '%  procs ' +
    j.machine?.before?.processCount + '  node ' + j.machine?.before?.nodeProcesses +
    '  zig ' + j.machine?.before?.zigProcesses)
  console.log('  printed floor (ratio of medians, worst cell): ' +
    (j.noiseFloor?.worst ? (j.noiseFloor.worst.dev * 100).toFixed(3) + '% on ' + j.noiseFloor.worst.what : 'n/a'))
  console.log('')
  console.log(pad('scenario', 13) + pad('metric', 8) + pad('interleaved: pairedMed', 24) +
    pad('medians', 11) + pad('mins', 11) + pad('trimmed', 11) + pad('BLOCKED medians', 17) + 'BLOCKED pairedMed')
  const names = Object.keys(j.raw.a.scen)
  const rows = []
  for (const n of names) {
    for (const [label, key] of [['thr', 'thr'], ['cpuMs', 'cpu'], ['rssKB', 'rss']]) {
      const a = j.raw.a.scen[n][key]
      const b = j.raw.b.scen[n][key]
      const e = ests(a, b)
      const [ba, bb] = blocked(a, b)
      const be = ests(ba, bb)
      rows.push({ scenario: n, metric: label, interleaved: e, blocked: be })
      console.log(pad(n, 13) + pad(label, 8) + pad(pc(e.pairedMedian), 24) + pad(pc(e.medians), 11) +
        pad(pc(e.mins), 11) + pad(pc(e.trimmed), 11) + pad(pc(be.medians), 17) + pc(be.pairedMedian))
    }
  }
  {
    const a = j.raw.a.wall, b = j.raw.b.wall
    const e = ests(a, b); const [ba, bb] = blocked(a, b); const be = ests(ba, bb)
    rows.push({ scenario: 'WHOLE', metric: 'wallMs', interleaved: e, blocked: be })
    console.log(pad('WHOLE', 13) + pad('wallMs', 8) + pad(pc(e.pairedMedian), 24) + pad(pc(e.medians), 11) +
      pad(pc(e.mins), 11) + pad(pc(e.trimmed), 11) + pad(pc(be.medians), 17) + pc(be.pairedMedian))
    const ar = j.raw.a.rss, br = j.raw.b.rss
    const er = ests(ar, br); const [bar, bbr] = blocked(ar, br); const ber = ests(bar, bbr)
    rows.push({ scenario: 'WHOLE', metric: 'peakRSSkb', interleaved: er, blocked: ber })
    console.log(pad('WHOLE', 13) + pad('peakRSSkb', 8) + pad(pc(er.pairedMedian), 24) + pad(pc(er.medians), 11) +
      pad(pc(er.mins), 11) + pad(pc(er.trimmed), 11) + pad(pc(ber.medians), 17) + pc(ber.pairedMedian))
  }

  // -- worst cell per estimator, which is what "the floor" means --------
  const worst = {}
  for (const r of rows) {
    for (const k of ['pairedMedian', 'medians', 'mins', 'trimmed']) {
      const d = Math.abs(r.interleaved[k] - 1)
      if (!Number.isFinite(d)) continue
      if (!worst[k] || d > worst[k].dev) worst[k] = { dev: d, what: r.scenario + ' ' + r.metric }
    }
    const db = Math.abs(r.blocked.medians - 1)
    if (Number.isFinite(db) && (!worst.blockedMedians || db > worst.blockedMedians.dev)) {
      worst.blockedMedians = { dev: db, what: r.scenario + ' ' + r.metric }
    }
  }
  console.log('')
  console.log('  worst |ratio-1| over every cell, by estimator:')
  for (const [k, v] of Object.entries(worst)) {
    console.log('    ' + pad(k, 16) + (v.dev * 100).toFixed(3) + '%   (' + v.what + ')')
  }

  // -- the same, restricted to CPU and to RSS, which is what is claimed --
  const only = (metric) => {
    const w = {}
    for (const r of rows.filter((x) => x.metric === metric)) {
      for (const k of ['pairedMedian', 'medians', 'mins', 'trimmed']) {
        const d = Math.abs(r.interleaved[k] - 1)
        if (Number.isFinite(d) && (!w[k] || d > w[k].dev)) w[k] = { dev: d, what: r.scenario }
      }
      const db = Math.abs(r.blocked.medians - 1)
      if (Number.isFinite(db) && (!w.blockedMedians || db > w.blockedMedians.dev)) w.blockedMedians = { dev: db, what: r.scenario }
    }
    return w
  }
  for (const m of ['cpuMs', 'rssKB', 'thr']) {
    const w = only(m)
    if (!Object.keys(w).length) continue
    console.log('  worst ' + m + ' cell: ' +
      Object.entries(w).map(([k, v]) => k + ' ' + (v.dev * 100).toFixed(3) + '%').join('   '))
  }

  // -- how much of the CPU floor is the COUNTER ------------------------
  console.log('')
  console.log('  GetProcessTimes granularity, per scenario (' + TICK_MS + ' ms tick):')
  for (const n of names) {
    const all = [...j.raw.a.scen[n].cpu, ...j.raw.b.scen[n].cpu]
    const ticks = all.map((x) => x / TICK_MS)
    const exact = ticks.filter((t) => Math.abs(t - Math.round(t)) < 1e-9).length
    const distinct = new Set(all).size
    const med = median(all)
    console.log('    ' + pad(n, 13) +
      ' samples ' + pad(all.length, 5) +
      ' exact tick multiples ' + pad(exact + '/' + all.length, 8) +
      ' distinct values ' + pad(distinct, 4) +
      ' median ' + pad(med.toFixed(1) + 'ms', 11) +
      ' = ' + pad((med / TICK_MS).toFixed(1) + ' ticks', 12) +
      ' one tick = ' + (med > 0 ? (TICK_MS / med * 100).toFixed(3) : 'n/a') + '% of it')
  }
}

const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: node tests/perf/ab-reanalyze.mjs <ab-strpool json> [...]')
  process.exit(2)
}
for (const f of files) report(f)
