// rest-run.mjs --out DIR --reps N arm...     arm = label:path-of-binary     (a Node arm is always added: label node)
// The REST scenario (rest/arm.mts: pairing, history sync, 45 HTTP calls, shutdown) runs against the zapo fake server on Node with the app as a child: the compiled binary, or
// `node zapo-rest-mysql.ts` for the Node arm. The app runs under pmon, so VmHWM of the app pid (pmon's rss_peak_kb) is the REST metric. Each run gets its own MySQL database.
// Parity: http.json, stanzas.json and exit.json of every compiled arm are normalised (ids, timestamps, qr, db names) and compared with the first Node arm.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
const W = process.env.BENCH_WORK, ROOT = process.env.BENCH_DIR, NODE = process.env.BENCH_NODE || 'node', TREE = process.env.TREE
const args = process.argv.slice(2)
let out = 'out', reps = 3, profile = null
const arms = []
for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '--out') out = args[++i]; else if (a === '--reps') reps = Number(args[++i]); else if (a === '--profile') { profile = [args[++i], args[++i]] } else arms.push(a) }
mkdirSync(out, { recursive: true })
const req = createRequire(process.env.ZB_APP + '/package.json')
const mysql = req('mysql2/promise')
const APPDIR = `${W}/rest`
const norm = (s) => s.replace(/zapo_[a-z0-9_]+/g, 'DB').replace(/3EB0[0-9A-F]{18}/g, 'RID')
  .replace(/"(uptimeMs|afterMs|ageMs|elapsedMs|ms|latencyMs|createdMs|issuedAt|qrAgeMs|clockSkewMs)":\s*-?\d+/g, '"$1":N').replace(/"qr":\s*"[^"]*"/g, '"qr":"QR"')
  .replace(/"(t|sid|id)":\s*"[^"]*"/g, '"$1":"V"').replace(/"seen":\s*\[[^\]]*\]/g, '"seen":V').replace(/"result":-?\d{1,4}\}/g, '"result":V}')
  .replace(/\b1[0-9]{9,12}\b/g, 'TS').replace(/\d+\.\d+-\d+/g, 'QID').replace(/bytes\(\d+\)/g, 'bytes(N)')
function fingerprint(dir) {
  const parts = []
  for (const f of ['http.json', 'stanzas.json', 'exit.json']) {
    let t = ''; try { t = readFileSync(`${dir}/${f}`, 'utf8') } catch { t = 'MISSING' }
    if (f === 'http.json') { try { t = JSON.stringify(JSON.parse(t).map((r) => ({ s: r.status, h: Object.fromEntries(Object.entries(r.headers || {}).filter(([k]) => k !== 'date')), b: norm(r.body_resp ?? String(r.error)) }))) } catch {} }
    else if (f === 'exit.json') { try { t = JSON.stringify(JSON.parse(t).exited) } catch {} }
    else t = norm(t)
    parts.push(f + ':' + t.length + ':' + [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))
  }
  return parts.join('|')
}
if (profile !== null) { // one run of a --layout-profile binary, SIGUSR1 where the HTTP requests begin; profile = [binary, profile-out]
  const db = 'zapo_profile'
  const c = await mysql.createConnection({ host: process.env.ZAPO_TEST_MYSQL_HOST ?? '127.0.0.1', port: Number(process.env.ZAPO_TEST_MYSQL_PORT ?? 3306), user: 'root', password: process.env.ZAPO_TEST_MYSQL_PASSWORD ?? '' })
  await c.query(`DROP DATABASE IF EXISTS ${db}`); await c.query(`CREATE DATABASE ${db}`); await c.end()
  const env = { ...process.env, RR_OUT: out, RR_APPDIR: APPDIR, RR_DBPORT: process.env.ZAPO_TEST_MYSQL_PORT ?? '3306', ZAPO_FAKE_SERVER: `${TREE}/packages/fake-server`, RR_SIGUSR1: '1', SCR_LAYOUT_PROFILE_OUT: profile[1] }
  const r = spawnSync(NODE, ['--import', 'tsx', `${ROOT}/rest/arm.mts`, 'profile', db, profile[0]], { cwd: TREE, env, maxBuffer: 1 << 28, timeout: 900e3 })
  writeFileSync(`${out}/profile-run.stdout.txt`, r.stdout.toString()); writeFileSync(`${out}/profile-run.stderr.txt`, r.stderr.toString().slice(-20000))
  console.log(`rest profile run exit=${r.status} profile=${profile[1]}`)
  process.exit(r.status === 0 ? 0 : 1)
}
const all = [`node:NODE`, ...arms]
const results = { reps, node: spawnSync(NODE, ['--version']).stdout.toString().trim(), runs: [] }
let nodeFp = null
for (let rep = 0; rep < reps; rep++) {
  const order = all.map((_, i) => all[(i + rep) % all.length])
  for (const a of order) {
    const label = a.split(':')[0], bin = a.slice(a.indexOf(':') + 1)
    const db = `zapo_${label.replace(/[^a-z0-9]/gi, '')}${rep}`
    const c = await mysql.createConnection({ host: process.env.ZAPO_TEST_MYSQL_HOST ?? '127.0.0.1', port: Number(process.env.ZAPO_TEST_MYSQL_PORT ?? 3306), user: 'root', password: process.env.ZAPO_TEST_MYSQL_PASSWORD ?? '' })
    await c.query(`DROP DATABASE IF EXISTS ${db}`); await c.query(`CREATE DATABASE ${db}`); await c.end()
    const run = `${out}/${label}.${rep}`; mkdirSync(run, { recursive: true })
    const pj = `${run}/pmon.json`
    const cmd = label === 'node' ? [NODE, `${APPDIR}/zapo-rest-mysql.ts`] : [bin]
    const env = { ...process.env, RR_OUT: run, RR_APPDIR: APPDIR, RR_DBPORT: process.env.ZAPO_TEST_MYSQL_PORT ?? '3306', ZAPO_FAKE_SERVER: `${TREE}/packages/fake-server` }
    const r = spawnSync(NODE, ['--import', 'tsx', `${ROOT}/rest/arm.mts`, 'arm', db, `${W}/pmon`, '-o', pj, '--', ...cmd], { cwd: TREE, env, maxBuffer: 1 << 28, timeout: 900e3 })
    writeFileSync(`${run}/arm.stdout.txt`, r.stdout.toString()); writeFileSync(`${run}/arm.stderr.txt`, r.stderr.toString().slice(-20000))
    let pm = null; try { pm = JSON.parse(readFileSync(pj, 'utf8')) } catch {}
    const fp = fingerprint(`${run}/arm`)
    if (label === 'node' && nodeFp === null) nodeFp = fp
    results.runs.push({ label, rep, exit: pm ? pm.exit : r.status, vmhwm_kb: pm?.rss_peak_kb ?? null, cpu_ms: pm?.cpu_self_ms ?? null, fp })
    console.error(`rep ${rep} ${label}: exit=${pm ? pm.exit : r.status} vmhwm_kb=${pm?.rss_peak_kb}`)
  }
}
for (const r of results.runs) r.parity = nodeFp === null ? 'no-node-ref' : r.fp === nodeFp ? 'SAME' : 'DIFFERS'
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 1))
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const pct = (a, b) => (a == null || b == null || a === 0 ? '' : `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(2)}%`)
const labels = ['node', ...arms.map((a) => a.split(':')[0])]
const rows = ['| arm | VmHWM kB per rep | median | vs base | parity |', '|---|---|---|---|---|']
for (const l of labels) {
  const rs = results.runs.filter((r) => r.label === l)
  const baseL = l.endsWith('-ordered') ? l.slice(0, -8) : l.startsWith('cand') ? 'base' + l.slice(4) : null
  rows.push(`| ${l} | ${rs.map((r) => r.vmhwm_kb).join(' / ')} | ${med(rs.map((r) => r.vmhwm_kb))} | ${baseL && labels.includes(baseL) ? pct(med(results.runs.filter((r) => r.label === baseL).map((r) => r.vmhwm_kb)), med(rs.map((r) => r.vmhwm_kb))) : ''} | ${[...new Set(rs.map((r) => r.parity))].join('/')} |`)
}
writeFileSync(`${out}/summary.md`, `REST (zapo-rest-mysql), reps: ${reps}, node ${results.node}\n\n` + rows.join('\n') + '\n')
writeFileSync(`${out}/summary.txt`, labels.map((l) => { const rs = results.runs.filter((r) => r.label === l); return `rest ${l} reps=${rs.length} exit=${rs.map((r) => r.exit).join(',')} vmhwm_kb=${rs.map((r) => r.vmhwm_kb).join(',')} median=${med(rs.map((r) => r.vmhwm_kb))} parity=${[...new Set(rs.map((r) => r.parity))].join('/')}` }).join('\n') + '\n')
console.log(readFileSync(`${out}/summary.txt`, 'utf8'))
