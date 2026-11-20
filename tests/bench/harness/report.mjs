// report.mjs RESULT_DIR [--top N] [--perf-top N]: print, to stdout (hence into the job log), the figures that otherwise live only in the uploaded artifact.
// Artifact downloads can be unavailable (egress limit), so everything a CPU judgement needs is echoed in compact form:
//   1. per arm: cpu_self / wall / rss medians over the reps (Node arm included) and the ratio of each arm to the Node arm and to base;
//   2. per callgrind arm: total Ir (control: must equal results.json ir and the "callgrind_Ir=" line), collector Ir, NON-collector Ir, and the top N functions by
//      exclusive Ir with the call count each function received (parsed straight from <label>.callgrind.out, no callgrind_annotate);
//   3. when a base and a cand arm both have callgrind output: the top N functions by |exclusive Ir delta|;
//   4. when perf output exists (<label>.perf.data from run.mjs --perf): the top leaf symbols.
// Total output is bounded: about (arms * (N + 12)) + N lines; N = 40 gives a few hundred lines at most.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const argv = process.argv.slice(2)
let dir = null, top = 40, perfTop = 25
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--top') top = Number(argv[++i]); else if (argv[i] === '--perf-top') perfTop = Number(argv[++i]); else dir = argv[i] }
if (!dir) { console.error('usage: report.mjs RESULT_DIR [--top N] [--perf-top N]'); process.exit(2) }
// the collector lane: same matcher as the judges' ir.py (cycle collector, trace/visit walkers), matched on the function name after the last ':' and before ' ['
const COLL = /(scr_collect_cycles|_trace(_v)?$|_visit$|^scr_cyc_(mark|scan|collect|trace|release)|scr_sb_visit|scr_mg_visit|scr_arr_trace|scr_roots|mark_gray|scan_black|collect_white|scr_cyc_on_release|scr_cyc_free\b)/
export function parseCallgrind(text) {
  const names = new Map(), self = new Map(), calls = new Map()
  let cur = null, callee = null, skip = false, total = null, summary = null
  const nameOf = (rest) => { // "(id) name" defines, "(id)" references
    const m = /^\((\d+)\)(?: (.*))?$/.exec(rest)
    if (!m) return rest
    if (m[2] !== undefined) names.set(m[1], m[2])
    return names.get(m[1]) ?? `?${m[1]}`
  }
  for (const line of text.split('\n')) {
    if (line === '') continue
    const c = line.charCodeAt(0)
    if (c >= 48 && c <= 57 || c === 43 || c === 45 || c === 42) { // cost line: "<pos> <cost>"
      const sp = line.indexOf(' ')
      if (sp < 0) continue
      if (skip) { skip = false; continue } // the line after calls= is the inclusive cost of that call, not self
      const v = Number(line.slice(sp + 1).split(' ')[0])
      if (cur !== null && Number.isFinite(v)) self.set(cur, (self.get(cur) ?? 0) + v)
      continue
    }
    if (line.startsWith('fn=')) cur = nameOf(line.slice(3))
    else if (line.startsWith('cfn=')) callee = nameOf(line.slice(4))
    else if (line.startsWith('calls=')) { const n = Number(line.slice(6).split(' ')[0]); calls.set(callee, (calls.get(callee) ?? 0) + n); skip = true }
    else if (line.startsWith('totals:')) total = Number(line.slice(7).trim().split(' ')[0])
    else if (line.startsWith('summary:')) summary = Number(line.slice(8).trim().split(' ')[0])
  }
  let sum = 0; for (const v of self.values()) sum += v
  return { self, calls, total: total ?? summary, sum }
}
const short = (n) => { const s = n.length > 110 ? n.slice(0, 107) + '...' : n; return s }
const fmt = (n) => n.toLocaleString('en-US')
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const ratio = (a, b) => (a == null || b == null || b === 0 ? '' : (a / b).toFixed(3) + 'x')
const rj = existsSync(`${dir}/results.json`) ? JSON.parse(readFileSync(`${dir}/results.json`, 'utf8')) : null
console.log(`===== BENCHREPORT begin (dir ${dir}, top ${top}) =====`)
if (rj) {
  const labels = [...new Set(rj.runs.map((r) => r.label))]
  const ALT = { cpu_self_ms: 'cpu_ms', rss_peak_kb: 'vmhwm_kb' } // rest-run.mjs names its fields cpu_ms / vmhwm_kb and records no wall
  const stat = (l, k) => med(rj.runs.filter((r) => r.label === l).map((r) => r[k] ?? r[ALT[k]]))
  console.log(`-- medians over reps (node ${rj.node}, store ${rj.store}, reps ${rj.reps}); ratio columns are arm/node and cand/base`)
  console.log('arm | n | cpu_self_ms (all reps) | cpu_self med | wall med | rss_peak_kb med | cpu/node | wall/node | cpu/base | wall/base')
  for (const l of labels) {
    const rs = rj.runs.filter((r) => r.label === l)
    const b = l.startsWith('cand') ? 'base' + l.slice(4) : null
    const hb = b && labels.includes(b)
    console.log([l, rs.length, rs.map((r) => Math.round(r.cpu_self_ms ?? r.cpu_ms)).join('/'), stat(l, 'cpu_self_ms'), stat(l, 'wall_ms'), stat(l, 'rss_peak_kb'),
      ratio(stat(l, 'cpu_self_ms'), stat('node', 'cpu_self_ms')), ratio(stat(l, 'wall_ms'), stat('node', 'wall_ms')),
      hb ? ratio(stat(l, 'cpu_self_ms'), stat(b, 'cpu_self_ms')) : '', hb ? ratio(stat(l, 'wall_ms'), stat(b, 'wall_ms')) : ''].join(' | '))
  }
}
const cgs = {}
for (const f of existsSync(dir) ? readdirSync(dir).sort() : []) {
  const m = /^(.*)\.callgrind\.out$/.exec(f)
  if (!m) continue
  const label = m[1], p = parseCallgrind(readFileSync(`${dir}/${f}`, 'utf8'))
  cgs[label] = p
  let coll = 0; for (const [k, v] of p.self) if (COLL.test(k)) coll += v
  const tot = p.total ?? p.sum
  const rir = rj?.ir?.[label]
  console.log(`-- callgrind ${label}: total_Ir=${tot} sum_of_exclusive=${p.sum} results.json_Ir=${rir ?? 'n/a'} control=${tot === rir && p.sum === tot ? 'EQUAL' : 'MISMATCH'} collector_Ir=${coll} noncollector_Ir=${tot - coll} functions=${p.self.size}`)
  console.log(`   rank | exclusive_Ir | pct | calls | function (top ${top})`)
  const rows = [...p.self].sort((a, b) => b[1] - a[1]).slice(0, top)
  rows.forEach(([k, v], i) => console.log(`   ${i + 1} | ${v} | ${(v / tot * 100).toFixed(2)}% | ${p.calls.get(k) ?? 0} | ${short(k)}`))
}
for (const l of Object.keys(cgs)) {
  const b = l.startsWith('cand') ? 'base' + l.slice(4) : null
  if (!b || !cgs[b]) continue
  const A = cgs[b], B = cgs[l], d = []
  for (const k of new Set([...A.self.keys(), ...B.self.keys()])) d.push([k, (B.self.get(k) ?? 0) - (A.self.get(k) ?? 0), A.self.get(k) ?? 0, B.self.get(k) ?? 0])
  d.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
  console.log(`-- callgrind delta ${l} - ${b}: total ${B.total - A.total} (${((B.total - A.total) / A.total * 100).toFixed(3)}%); top ${top} functions by |exclusive delta|`)
  console.log('   delta_Ir | base_Ir | cand_Ir | function')
  for (const [k, dv, a, c] of d.slice(0, top)) console.log(`   ${dv > 0 ? '+' : ''}${dv} | ${a} | ${c} | ${short(k)}`)
}

// threads (PMON_THREADS=1 -> pmon.c): CPU per thread group and where the non-running samples were blocked, from the FIRST rep of each arm's pmon json
const SYS = { 0: 'read', 1: 'write', 7: 'poll', 17: 'pread64', 18: 'pwrite64', 23: 'select', 35: 'nanosleep', 44: 'sendto', 45: 'recvfrom', 46: 'sendmsg', 47: 'recvmsg', 202: 'futex', 230: 'clock_nanosleep', 232: 'epoll_wait', 270: 'pselect6', 271: 'ppoll', 281: 'epoll_pwait', 441: 'epoll_pwait2' }
for (const f of existsSync(dir) ? readdirSync(dir).sort() : []) {
  const m = /^(.*)\.0\.pmon\.json$/.exec(f)
  if (!m) continue
  let pj; try { pj = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) } catch { continue }
  if (!pj.marks) continue
  const label = m[1]
  if (pj.threads && pj.threads.length) {
    const lane = pj.threads.find((t) => t.main && pj.threads.every((u) => u.pid >= t.pid || true))
    const pids = [...new Set(pj.threads.map((t) => t.pid))]
    const laneP = pids.reduce((a, b) => (a < b ? a : b)) // the lane is the first process pmon forked: the lowest pid (descendants fork later)
    console.log(`-- threads ${label} rep 0 (wall ${pj.wall_ms} ms, pmon cpu_self ${pj.cpu_self_ms} ms; per-thread cpu is a floor, sampled every ~50 ms)`)
    console.log('   process | thread group (comm) | n threads | cpu_ms | samples running | samples blocked by syscall')
    const g = new Map()
    for (const t of pj.threads) {
      const k = `${t.pid === laneP ? 'LANE' : 'child ' + t.pid}|${t.comm.replace(/\d+$/, '')}`
      const e = g.get(k) ?? { n: 0, cpu: 0, run: 0, tot: 0, sys: {} }
      e.n++; e.cpu += t.cpu_ms; e.run += t.running; e.tot += t.samples
      for (const [q, c] of Object.entries(t.sys)) e.sys[q] = (e.sys[q] ?? 0) + c
      g.set(k, e)
    }
    for (const [k, e] of [...g].sort((a, b) => b[1].cpu - a[1].cpu).slice(0, 14)) {
      const sy = Object.entries(e.sys).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q, c]) => `${SYS[q] ?? 'sys' + q}=${c}`).join(' ')
      console.log(`   ${k.split('|').join(' | ')} | ${e.n} | ${Math.round(e.cpu)} | ${e.run}/${e.tot} | ${sy}`)
    }
  }
  if (pj.marks.length) {
    console.log(`-- phases ${label} rep 0: wall ms | cpu_self ms | cpu/wall | mark`)
    let pt = 0, pc = 0
    for (const mk of pj.marks.slice(0, 60)) {
      const dt = mk.t_ms - pt, dc = mk.cpu_ms - pc
      console.log(`   ${Math.round(dt)} | ${Math.round(dc)} | ${dt > 0 ? (dc / dt).toFixed(2) : ''} | ${String(mk.line).slice(0, 70)}`)
      pt = mk.t_ms; pc = mk.cpu_ms
    }
  }
}
for (const f of existsSync(dir) ? readdirSync(dir).sort() : []) {
  const m = /^(.*)\.perf\.data$/.exec(f)
  if (!m) continue
  const r = spawnSync('perf', ['report', '-i', `${dir}/${f}`, '--stdio', '--no-children', '--sort', 'sym', '--percent-limit', '0.3'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const ls = (r.stdout || '').split('\n').filter((x) => x.trim() !== '' && !x.startsWith('#'))
  console.log(`-- perf leaves ${m[1]} (self, top ${perfTop}; exit ${r.status})`)
  for (const x of ls.slice(0, perfTop)) console.log('   ' + x.trim().replace(/\s+/g, ' ').slice(0, 140))
  if (ls.length === 0) console.log('   (no samples: ' + (r.stderr || '').split('\n')[0] + ')')
}
console.log('===== BENCHREPORT end =====')
