/* benchstat.mjs — turn a bench.sh log into paired ratios with a stated floor.
 *
 *   node benchstat.mjs <bench-log> [--base LABEL] [--floor <floor-log>]
 *   node benchstat.mjs <bench-log> --selftest
 *
 * THE RULES THIS ENCODES, so they cannot be forgotten in a hurry:
 *
 *  1. A ratio is only ever formed between two arms of the SAME rep. The host
 *     drifts ~10% per rep; an across-rep ratio is not a measurement.
 *  2. The reported value is the MEDIAN of the per-rep ratios, with the full
 *     [min .. max] beside it. A median without its spread is a claim without
 *     an error bar.
 *  3. A FLOOR IS A DRAW, NOT A VALUE. Pass --floor with an A/A log (the same
 *     binary as two arms) and every delta smaller than the floor's half-width
 *     is printed as DRAW. Without --floor the tool refuses to call anything a
 *     difference: it prints ratios and says the floor is UNKNOWN.
 *  4. Every number names its lane, its binary and its host state — those come
 *     from the log's own ### header, which bench.sh writes before it runs
 *     anything, and are reprinted here rather than summarised away.
 *
 * --selftest runs rule 3 against itself: it fabricates an A/A pair with the
 * host drift the real one has, and asserts the tool reports NO DIFFERENCE. A
 * comparison harness that cannot produce a null result has not been shown to
 * be able to produce a true one.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* ── parsing ─────────────────────────────────────────────────────────── */

/** One run of one arm in one rep. */
function parse(path) {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  const header = lines.filter((l) => l.startsWith('###'))
  const runs = []
  let cur = null
  for (const line of lines) {
    let m = line.match(/^===ARM (\S+) REP (\d+)\b.*lane=(\S+) src=(\S+)/)
    if (m) {
      cur = { arm: m[1], rep: Number(m[2]), lane: m[3], src: m[4], scenarios: [], peakRssMiB: null, phases: [] }
      runs.push(cur)
      continue
    }
    if (cur === null) continue
    m = line.match(/^===ARMEXIT \S+ REP \d+ rc=(\d+)/)
    if (m) {
      cur.rc = Number(m[1])
      cur = null
      continue
    }
    /* The bench's own per-scenario JSON. Its wall clock is measured inside
     * the same source both lanes run, so it is the one directly comparable
     * timing number. */
    m = line.match(/^\s*"name":\s*"([^"]+)"/)
    if (m) cur.scenarios.push({ name: m[1] })
    m = line.match(/^\s*"elapsedMs":\s*([0-9.]+)/)
    if (m && cur.scenarios.length > 0) cur.scenarios[cur.scenarios.length - 1].elapsedMs = Number(m[1])
    m = line.match(/^\s*"messages":\s*(\d+)/)
    if (m && cur.scenarios.length > 0) cur.scenarios[cur.scenarios.length - 1].messages = Number(m[1])
    /* cpuphase, from outside the process. */
    m = line.match(/peakRSS=([0-9.]+) MiB/)
    if (m) cur.peakRssMiB = Number(m[1])
    m = line.match(/^\[cpuphase\] (\S+)\s+(\d+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)%/)
    if (m) cur.phases.push({ name: m[1], wallMs: Number(m[2]), mcycles: Number(m[3]), cpuMs: Number(m[6]) })
  }
  return { header, runs }
}

/* ── metrics ─────────────────────────────────────────────────────────── */

/** metric key -> value, for one run. Missing metrics stay absent, never 0. */
function metricsOf(run) {
  const out = new Map()
  for (const s of run.scenarios) {
    if (typeof s.elapsedMs === 'number') out.set(`wall:${s.name}`, s.elapsedMs)
  }
  for (const p of run.phases) {
    out.set(`cycles:${p.name}`, p.mcycles)
    out.set(`cpuMs:${p.name}`, p.cpuMs)
  }
  if (run.peakRssMiB !== null) out.set('peakRSS', run.peakRssMiB)
  return out
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/** Per-rep ratios arm/base for every metric both runs carry. */
function ratios(runs, base, arm) {
  const byRep = new Map()
  for (const r of runs) {
    if (!byRep.has(r.rep)) byRep.set(r.rep, new Map())
    byRep.get(r.rep).set(r.arm, r)
  }
  const out = new Map()
  for (const [, arms] of byRep) {
    const b = arms.get(base)
    const a = arms.get(arm)
    if (!b || !a) continue
    const bm = metricsOf(b)
    const am = metricsOf(a)
    for (const [k, av] of am) {
      const bv = bm.get(k)
      if (bv === undefined || bv === 0) continue
      if (!out.has(k)) out.set(k, [])
      out.get(k).push(av / bv)
    }
  }
  return out
}

/** The floor's half-width per metric: how far from 1.0 an A/A pair wandered.
 *
 * POOLED over as many A/A logs as are given, because max|r-1| over a handful
 * of reps is NOT a bound -- it is the maximum of a small sample, and it moves
 * enormously. Measured, on this host, same binary both arms: cycles:recv_group
 * read +-0.80% in one 4-rep A/A and +-8.30% in the very next one. A gate built
 * on the first would have called a 0.9% A/A difference a result. Pooling every
 * A/A rep available is the cheapest honest fix; `n` is printed so a reader can
 * see how thin the estimate still is. */
function floorOf(paths) {
  const half = new Map()
  const counts = new Map()
  let reps = 0
  const labelSets = []
  for (const path of [paths].flat()) {
    const { runs } = parse(path)
    const labels = [...new Set(runs.map((r) => r.arm))]
    if (labels.length !== 2) {
      console.error(`floor log ${path} has ${labels.length} arm(s); an A/A floor needs exactly 2`)
      process.exit(2)
    }
    labelSets.push(`${path} (${labels.join('/')})`)
    reps += new Set(runs.map((r) => r.rep)).size
    for (const [k, vs] of ratios(runs, labels[0], labels[1])) {
      const w = Math.max(...vs.map((v) => Math.abs(v - 1)))
      half.set(k, Math.max(half.get(k) ?? 0, w))
      counts.set(k, (counts.get(k) ?? 0) + vs.length)
    }
  }
  return { half, counts, reps, sources: labelSets }
}

/* ── report ──────────────────────────────────────────────────────────── */

function report(logPath, baseLabel, floorPath) {
  const { header, runs } = parse(logPath)
  for (const h of header) console.log(h)
  const bad = runs.filter((r) => r.rc !== 0)
  if (bad.length > 0) {
    console.log(`\n!! ${bad.length} run(s) exited non-zero — a truncated run must not be averaged away:`)
    for (const r of bad) console.log(`   ${r.arm} rep ${r.rep} rc=${r.rc}`)
  }
  const labels = [...new Set(runs.map((r) => r.arm))]
  const base = baseLabel ?? labels[0]
  const reps = new Set(runs.map((r) => r.rep)).size
  console.log(`\nbase arm: ${base}   arms: ${labels.join(', ')}   reps: ${reps}`)

  let fl = null
  if (floorPath !== undefined) {
    /* A floor taken from the log being measured is self-referential: the
     * half-width IS the observed deviation, so every metric is a DRAW by
     * construction and the verdict column means nothing. The floor has to be
     * a SEPARATE A/A run. */
    if ([floorPath].flat().some((f) => resolve(f) === resolve(logPath)) && !process.argv.includes('--degenerate-floor-ok')) {
      console.error(
        `\nREFUSING: --floor is the same file as the measurement log.\n` +
          `  A self-referential floor makes every metric a DRAW by construction.\n` +
          `  Take a separate A/A run (the same binary as both arms) and pass that.\n` +
          `  --degenerate-floor-ok overrides, for inspecting an A/A log's own spread.`,
      )
      process.exit(2)
    }
    fl = floorOf(floorPath)
    console.log(`floor: A/A over ${fl.reps} rep(s), pooled from ${fl.sources.length} log(s):`)
    for (const src of fl.sources) console.log(`         ${src}`)
    const worst = [...fl.half.entries()].sort((a, b) => b[1] - a[1])[0]
    if (worst) console.log(`       widest metric ${worst[0]} +/- ${(worst[1] * 100).toFixed(2)}%`)
  } else {
    console.log('floor: UNKNOWN — no --floor given, so nothing below is called a difference')
  }

  for (const arm of labels) {
    if (arm === base) continue
    console.log(`\n=== ${arm} / ${base} ===`)
    const rs = ratios(runs, base, arm)
    const keys = [...rs.keys()].sort()
    console.log('  metric                         median      [min .. max]   verdict')
    for (const k of keys) {
      const vs = rs.get(k)
      const med = median(vs)
      const lo = Math.min(...vs)
      const hi = Math.max(...vs)
      let verdict
      if (fl === null) verdict = 'no floor — not called'
      else {
        const h = fl.half.get(k)
        if (h === undefined) verdict = 'no floor for this metric'
        else if (Math.abs(med - 1) <= h) verdict = `DRAW (inside floor +/-${(h * 100).toFixed(2)}%)`
        else verdict = med > 1 ? `SLOWER/LARGER by ${((med - 1) * 100).toFixed(1)}%` : `FASTER/SMALLER by ${((1 - med) * 100).toFixed(1)}%`
      }
      console.log(
        `  ${k.padEnd(28)} ${med.toFixed(4).padStart(8)}   [${lo.toFixed(4)} .. ${hi.toFixed(4)}]   ${verdict}`,
      )
    }
  }
}

/* ── self-test ───────────────────────────────────────────────────────── */

function selftest() {
  /* Rule 3, against itself: an A/A pair with this host's drift baked in must
   * come out as no difference. The drift is applied PER REP to both arms, the
   * way the host actually drifts, so a tool that compared across reps would
   * fail this and a tool that compares within a rep passes it. */
  const drift = [1.0, 1.1, 0.93, 1.22, 0.88]
  const lines = ['### selftest synthetic A/A']
  const mk = (arm, rep, wall, rss) =>
    [
      `===ARM ${arm} REP ${rep} 00:00:00 lane=exe src=x`,
      `    "name": "SEND 1:1",`,
      `    "elapsedMs": ${wall},`,
      `[cpumem] samples=9  firstRSS=1.00 MiB  peakRSS=${rss} MiB  finalRSS=1.00 MiB`,
      `===ARMEXIT ${arm} REP ${rep} rc=0`,
    ].join('\n')
  drift.forEach((d, i) => {
    lines.push(mk('a', i + 1, (1000 * d).toFixed(3), (100 * d).toFixed(2)))
    lines.push(mk('b', i + 1, (1000 * d).toFixed(3), (100 * d).toFixed(2)))
  })
  const tmp = `${process.env.TMPDIR ?? process.env.TMP ?? '.'}/benchstat-selftest.txt`
  const fs = require('node:fs')
  fs.writeFileSync(tmp, lines.join('\n'))
  const { runs } = parse(tmp)
  const rs = ratios(runs, 'a', 'b')
  let ok = true
  for (const [k, vs] of rs) {
    const med = median(vs)
    if (Math.abs(med - 1) > 1e-9) {
      console.error(`SELFTEST FAILED: A/A on ${k} reported ${med}, expected exactly 1`)
      ok = false
    }
  }
  if (rs.size === 0) {
    console.error('SELFTEST FAILED: no metrics parsed — the parser is blind, which would read as "no difference"')
    ok = false
  }
  /* Negative control: the tool must NOT report a draw for a real 20% change,
   * so a passing A/A cannot be the parser silently returning nothing. */
  const shifted = lines.map((l) =>
    l.includes('===ARM b ') || false ? l : l,
  )
  const lines2 = []
  drift.forEach((d, i) => {
    lines2.push(mk('a', i + 1, (1000 * d).toFixed(3), (100 * d).toFixed(2)))
    lines2.push(mk('b', i + 1, (1200 * d).toFixed(3), (120 * d).toFixed(2)))
  })
  fs.writeFileSync(tmp, ['### selftest synthetic A/B'].concat(lines2).join('\n'))
  const rs2 = ratios(parse(tmp).runs, 'a', 'b')
  const med2 = median(rs2.get('wall:SEND 1:1') ?? [])
  if (med2 === null || Math.abs(med2 - 1.2) > 1e-9) {
    console.error(`SELFTEST FAILED: a real +20% read as ${med2}, expected 1.2 — the tool cannot see a difference`)
    ok = false
  }
  if (!ok) process.exit(3)
  console.log('selftest ok:')
  console.log(`  A/A with +-22% host drift  -> ratio exactly 1.0000 on ${rs.size} metric(s)  [NO DIFFERENCE]`)
  console.log(`  A/B with a real +20%       -> ratio ${med2.toFixed(4)}  [seen, not swallowed]`)
  console.log(`  (${shifted.length} synthetic lines parsed; drift applied per rep to BOTH arms,`)
  console.log('   so a tool comparing ACROSS reps would fail the first case)')
}

/* ── main ────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) {
  const { createRequire } = await import('node:module')
  globalThis.require = createRequire(import.meta.url)
  selftest()
} else {
  const log = argv[0]
  if (log === undefined) {
    console.error('usage: benchstat.mjs <bench-log> [--base LABEL] [--floor <floor-log>]')
    process.exit(2)
  }
  const bi = argv.indexOf('--base')
  const floors = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--floor') floors.push(argv[i + 1])
  report(log, bi >= 0 ? argv[bi + 1] : undefined, floors.length > 0 ? floors : undefined)
}
