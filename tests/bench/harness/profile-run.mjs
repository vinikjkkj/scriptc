// profile-run.mjs <store> <binary> <profile-out> <outdir>
// One run of a --layout-profile build with SIGUSR1 sent where the real work starts (the first [phase-begin] line the bench prints): functions hot in the steady state are
// logged again in the epoch after the signal, startup-only ones are not. The profile goes to <profile-out> (SCR_LAYOUT_PROFILE_OUT).
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
const [store, bin, prof, out] = process.argv.slice(2)
const NODE = process.env.BENCH_NODE || 'node'
mkdirSync(out, { recursive: true })
const r0 = spawnSync(NODE, [`${process.env.BENCH_DIR}/harness/resetdb.mjs`, store], { stdio: 'inherit' }); if (r0.status !== 0) process.exit(3)
const env = { ...process.env, ZAPO_BENCH_STORE: store, ZAPO_BENCH_JSON: '1', SCR_LAYOUT_PROFILE_OUT: prof }
const c = spawn(bin, [], { cwd: process.env.TREE, env, stdio: ['ignore', 'pipe', 'pipe'] })
let signalled = false, buf = '', all = '', err = ''
c.stdout.on('data', (d) => { const s = d.toString(); all += s; buf += s; if (!signalled && buf.includes('[phase-begin]')) { signalled = true; c.kill('SIGUSR1') } })
c.stderr.on('data', (d) => { err += d.toString() })
const code = await new Promise((res) => c.on('exit', (x) => res(x)))
writeFileSync(`${out}/profile-run.stdout.txt`, all); writeFileSync(`${out}/profile-run.stderr.txt`, err.slice(-20000))
console.log(`profile run exit=${code} signalled=${signalled} profile=${prof}`)
process.exit(code === 0 && signalled ? 0 : 1)
