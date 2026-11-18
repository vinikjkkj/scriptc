// rest-refused.mjs --out DIR arm...    arm = label:path-of-binary   (a Node arm is always added: label node)
// LAB ONLY (connref1): the REST app with NO MySQL reachable. Each arm is spawned with ZAPO_MYSQL_PORT=1 (closed; no service involved), autoconnect off, and given 8 s.
// Record: the app's own console lines, whether the process is still alive after 8 s, and the HTTP status of GET /health. The bar: the compiled arms print the same
// `store    : FAILED to reach` line as Node and stay alive and serving. Exit code 1 when an arm died, lacks the line, or differs from Node.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const W = process.env.BENCH_WORK, NODE = process.env.BENCH_NODE || 'node'
const args = process.argv.slice(2); let out = 'out'; const arms = []
for (let i = 0; i < args.length; i++) { if (args[i] === '--out') out = args[++i]; else arms.push(args[i]) }
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const all = ['node:NODE', ...arms]
const rep = []
let port = 8790
for (const a of all) {
  const label = a.split(':')[0], bin = a.slice(a.indexOf(':') + 1)
  const cmd = label === 'node' ? [NODE, `${W}/rest/zapo-rest-mysql.ts`] : [bin]
  const env = { ...process.env, ZAPO_REST_HOST: '127.0.0.1', ZAPO_REST_PORT: String(++port), ZAPO_SESSION: 'drive', ZAPO_AUTOCONNECT: '0',
    ZAPO_MYSQL_PORT: '1', ZAPO_MYSQL_DATABASE: 'zapo_refused', ZAPO_MYSQL_HOST: '127.0.0.1' }
  let log = '', exited = null
  const c = spawn(cmd[0], cmd.slice(1), { cwd: `${W}/rest`, env, stdio: ['ignore', 'pipe', 'pipe'] })
  c.stdout.on('data', (d) => { log += d }); c.stderr.on('data', (d) => { log += d })
  c.on('exit', (code, signal) => { exited = { code, signal } })
  await sleep(8000)
  let health = null
  if (exited === null) { try { const r = await fetch(`http://127.0.0.1:${port}/health`); health = r.status } catch (e) { health = 'ERR ' + e.message } }
  const aliveAt8s = exited === null
  if (aliveAt8s) { c.kill('SIGTERM'); await sleep(1500) } // the child this script spawned
  writeFileSync(`${out}/${label}.log`, log)
  const failed = log.split('\n').filter((l) => l.includes('store    : FAILED to reach'))
  rep.push({ label, aliveAt8s, exited, health, failedLines: failed, uncaught: /Uncaught/.test(log) })
  console.log(`== ${label}: aliveAt8s=${aliveAt8s} exited=${JSON.stringify(exited)} health=${health} uncaught=${/Uncaught/.test(log)}`)
  for (const l of failed) console.log('   ' + l.trim())
  console.log('   --- first lines of the log'); for (const l of log.split('\n').slice(0, 12)) console.log('   | ' + l)
}
writeFileSync(`${out}/refused.json`, JSON.stringify(rep, null, 1))
const node = rep.find((r) => r.label === 'node')
let bad = 0
for (const r of rep) {
  const ok = r.aliveAt8s && r.failedLines.length === 1 && !r.uncaught && r.failedLines[0] === node.failedLines[0]
  console.log(`VERDICT ${r.label}: ${ok ? 'PASS' : 'FAIL'}`); if (!ok) bad++
}
process.exit(bad ? 1 : 0)
