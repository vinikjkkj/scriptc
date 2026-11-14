// run.mjs --store S --out DIR --reps N [--node] [--smaps] [--ir MSGS] arm...        arm = label:path-of-binary
// For every rep the arms run back to back in rotated order (ratios are formed inside a rep). Every run is wrapped in pmon (rss_peak_kb, cpu, per-phase marks) with the
// zapo tree as the working directory, after resetdb gave it an empty database. Output parity: the scenario JSON each run prints is reduced to the fields that do not
// move between runs ({name, messages} per scenario; every other field is a timing or a memory figure) and hashed; an arm passes when its hash equals the Node run's.
// --node runs the same bench entry on Node (tsx) as the parity reference; --smaps adds one smapspeak run per arm (the smaps snapshot at the highest VmRSS, by bucket);
// --ir MSGS adds one callgrind run per arm with ZAPO_BENCH_MESSAGES=MSGS. CPU seconds on shared runners are noise: only callgrind Ir is a CPU figure here.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const W = process.env.BENCH_WORK, ROOT = process.env.BENCH_DIR, NODE = process.env.BENCH_NODE || 'node', TREE = process.env.TREE
const args = process.argv.slice(2)
let store = 'memory', out = 'out', reps = 3, withNode = false, smaps = false, irMsgs = 0
const arms = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--store') store = args[++i]; else if (a === '--out') out = args[++i]; else if (a === '--reps') reps = Number(args[++i])
  else if (a === '--node') withNode = true; else if (a === '--smaps') smaps = true; else if (a === '--ir') irMsgs = Number(args[++i])
  else arms.push(a)
}
mkdirSync(out, { recursive: true })
const md5 = (s) => createHash('md5').update(s).digest('hex')
const resetdb = () => { const r = spawnSync(NODE, [`${ROOT}/harness/resetdb.mjs`, store], { stdio: 'inherit' }); if (r.status !== 0) { console.error('resetdb failed'); process.exit(3) } }
const entry = `packages/fake-server/bench-messaging-${store}/messaging.bench.ts`
const envFor = () => ({ ...process.env, ZAPO_BENCH_STORE: store, ZAPO_BENCH_JSON: '1' })
function scenarios(stdout) {
  const k = stdout.lastIndexOf('\n[\n')
  if (k < 0) return null
  try { return JSON.parse(stdout.slice(k + 1)) } catch { return null }
}
const mask = (sc) => (sc === null ? 'NOPARSE' : md5(JSON.stringify(sc.map((s) => ({ name: s.name, messages: s.messages })))))
const results = { store, reps, node: spawnSync(NODE, ['--version']).stdout.toString().trim(), started: new Date().toISOString(), runs: [], smaps: {}, ir: {} }
const lines = []
function one(label, cmd, rep) {
  resetdb()
  const pj = `${out}/${label}.${rep}.pmon.json`
  const r = spawnSync(`${W}/pmon`, ['-o', pj, '--', ...cmd], { cwd: TREE, env: envFor(), maxBuffer: 1 << 28, timeout: 3600e3 })
  const stdout = r.stdout.toString()
  writeFileSync(`${out}/${label}.${rep}.stdout.txt`, stdout)
  writeFileSync(`${out}/${label}.${rep}.stderr.txt`, r.stderr.toString().slice(-20000))
  let pm = null; try { pm = JSON.parse(readFileSync(pj, 'utf8')) } catch {}
  const run = { label, rep, exit: pm ? pm.exit : r.status, rss_peak_kb: pm?.rss_peak_kb ?? null, cpu_self_ms: pm?.cpu_self_ms ?? null, wall_ms: pm?.wall_ms ?? null, parity_md5: mask(scenarios(stdout)) }
  results.runs.push(run)
  return run
}
const labels = arms.map((a) => a.split(':')[0])
const bin = (a) => a.slice(a.indexOf(':') + 1)
const all = withNode ? ['node:NODE', ...arms] : arms
let nodeHash = null
for (let rep = 0; rep < reps; rep++) {
  const order = all.map((_, i) => all[(i + rep) % all.length])
  for (const a of order) {
    const label = a.split(':')[0]
    const run = label === 'node' ? one('node', [NODE, '--import', 'tsx', entry], rep) : one(label, [bin(a)], rep)
    if (label === 'node' && nodeHash === null) nodeHash = run.parity_md5
  }
}
for (const run of results.runs) run.parity = nodeHash === null ? 'no-node-ref' : run.parity_md5 === nodeHash ? 'SAME' : 'DIFFERS'
if (smaps) for (const a of arms) {
  const label = a.split(':')[0]; resetdb()
  const sj = `${out}/${label}.smaps.json`
  spawnSync('python3', [`${ROOT}/harness/smapspeak.py`, sj, '--', bin(a)], { cwd: TREE, env: envFor(), timeout: 3600e3 })
  try { results.smaps[label] = JSON.parse(readFileSync(sj, 'utf8')) } catch { results.smaps[label] = null }
}
if (irMsgs > 0) for (const a of arms) {
  const label = a.split(':')[0]; resetdb()
  mkdirSync(`${out}/cg`, { recursive: true }); copyFileSync(bin(a), `${out}/cg/prog`); spawnSync('chmod', ['+x', `${out}/cg/prog`])
  const cg = `${out}/${label}.callgrind.out`
  const env = { ...envFor(), ZAPO_BENCH_MESSAGES: String(irMsgs), ZAPO_BENCH_PREKEY_TIMEOUT_MS: '600000' }
  const r = spawnSync('valgrind', ['--tool=callgrind', `--callgrind-out-file=${cg}`, `${out}/cg/prog`], { cwd: TREE, env, maxBuffer: 1 << 28, timeout: 3 * 3600e3 })
  const m = /Collected\s*:\s*(\d+)/.exec(r.stderr.toString())
  results.ir[label] = m ? Number(m[1]) : null
}
results.finished = new Date().toISOString()
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1))
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const sumlines = []
for (const l of [...(withNode ? ['node'] : []), ...labels]) {
  const rs = results.runs.filter((r) => r.label === l)
  const sm = results.smaps[l]
  sumlines.push(`${store} ${l} reps=${rs.length} exit=${rs.map((r) => r.exit).join(',')} rss_peak_kb=${rs.map((r) => r.rss_peak_kb).join(',')} median=${med(rs.map((r) => r.rss_peak_kb))} parity=${[...new Set(rs.map((r) => r.parity))].join('/')}${results.ir[l] != null ? ` callgrind_Ir=${results.ir[l]}` : ''}${sm && sm.classes ? ` smaps_peak_vmrss_kb=${sm.peak_vmrss_kb} heap_brk=${sm.classes['heap(brk)']?.Rss ?? 0} anon_mmap=${sm.classes['anon-mmap']?.Rss ?? 0} file_backed=${Object.entries(sm.classes).filter(([k]) => /^(main-binary|shared-libs)/.test(k)).reduce((t, [, v]) => t + v.Rss, 0)} stack=${sm.classes.stack?.Rss ?? 0}` : ''}`)
}
writeFileSync(`${out}/summary.txt`, sumlines.join('\n') + '\n')
// summary.md: one table; when a `base` and a `cand` arm both ran (bench.yml with two targets, built and measured on the same runner), each cand row also carries its difference to the matching base row
const pct = (a, b) => (a == null || b == null || a === 0 ? '' : `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(2)}%`)
const rows = ['| arm | rss_peak_kb per rep | median | vs base | parity | callgrind Ir | Ir vs base | heap_brk | file-backed | exe code | exe rodata |', '|---|---|---|---|---|---|---|---|---|---|---|']
const rssMed = (l) => med(results.runs.filter((r) => r.label === l).map((r) => r.rss_peak_kb))
for (const l of [...(withNode ? ['node'] : []), ...labels]) {
  const rs = results.runs.filter((r) => r.label === l)
  const baseL = l.startsWith('cand') ? 'base' + l.slice(4) : null
  const hasBase = baseL !== null && labels.includes(baseL)
  const sm = results.smaps[l]
  const fb = sm && sm.classes ? Object.entries(sm.classes).filter(([k]) => /^(main-binary|shared-libs)/.test(k)).reduce((t, [, v]) => t + v.Rss, 0) : ''
  rows.push(`| ${l} | ${rs.map((r) => r.rss_peak_kb).join(' / ')} | ${rssMed(l)} | ${hasBase ? pct(rssMed(baseL), rssMed(l)) : ''} | ${[...new Set(rs.map((r) => r.parity))].join('/')} | ${results.ir[l] ?? ''} | ${hasBase ? pct(results.ir[baseL], results.ir[l]) : ''} | ${sm && sm.classes ? sm.classes['heap(brk)']?.Rss ?? 0 : ''} | ${fb} | ${sm && sm.classes ? sm.classes['main-binary:code(r-x)']?.Rss ?? 0 : ''} | ${sm && sm.classes ? sm.classes['main-binary:rodata(r--)']?.Rss ?? 0 : ''} |`)
}
writeFileSync(`${out}/summary.md`, `store: ${store}, reps: ${reps}, node ${results.node}\n\n` + rows.join('\n') + '\n')
console.log(sumlines.join('\n'))
