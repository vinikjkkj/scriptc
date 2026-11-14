/* ladder-prekeytimeout.mjs — the fake server's pre-key wait gets an env knob.
 *
 *   node ladder-prekeytimeout.mjs [<fake-server-dir>]
 *
 * Why: the fake server (a separate NODE process, never compiled) waits for the client's pre-key bundle with a hard-coded 15 s
 * wall-clock timer (PreKeyDispenser.awaitPreKeyBundle and the bundle-low path; FakeWaServer.awaitPreKeyBundle forwards the default).
 * Under valgrind/callgrind the compiled client runs about 50x slower, so the timer fires on a slow-but-correct run and the bench dies
 * with "awaitPreKeyBundle timed out after 15000ms" (measured twice on the optic arm A/B, 2026-11-09). The timer measures the harness,
 * not the program, so callgrind runs raise it.
 *
 * What: ONE constant, PREKEY_DEFAULT_TIMEOUT_MS = Number(process.env.ZAPO_BENCH_PREKEY_TIMEOUT_MS ?? 15000), used at the same three
 * default sites. With the variable UNSET the behaviour is byte-for-byte what it was (15000). Set it to the SAME value on every arm of an
 * A/B (callgrind runs: 600000) and say so in the report.
 *
 * This is a MEASUREMENT patch to the rig's COPY of the fake server ($BENCH_WORK/app/tree/packages/fake-server), never to the
 * user's app. Idempotent: a second run finds the marker and changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? join(process.env.BENCH_WORK, 'app/tree/packages/fake-server')
const api = join(root, 'src/api')
const MARK = 'ZAPO_BENCH_PREKEY_TIMEOUT_MS'

function edit(file, steps) {
  const p = join(api, file)
  let s = readFileSync(p, 'utf8')
  if (s.includes(MARK)) { console.log(`${file}: already patched`); return }
  for (const [from, to] of steps) {
    if (!s.includes(from)) { console.error(`${file}: expected text not found: ${from}`); process.exit(1) }
    s = s.replace(from, to)
  }
  writeFileSync(p, s)
  console.log(`${file}: patched`)
}

edit('PreKeyDispenser.ts', [
  [
    "interface PendingPreKeyBundleWaiter {",
    "// The wait for the client's pre-key bundle. ZAPO_BENCH_PREKEY_TIMEOUT_MS raises it for runs where the client is ~50x slower than the\n// wall-clock timer assumes (callgrind); unset it is the original 15 s.\nconst PREKEY_DEFAULT_TIMEOUT_MS = Number(process.env['ZAPO_BENCH_PREKEY_TIMEOUT_MS'] ?? 15_000)\n\ninterface PendingPreKeyBundleWaiter {",
  ],
  ["public awaitPreKeyBundle(timeoutMs = 15_000)", "public awaitPreKeyBundle(timeoutMs = PREKEY_DEFAULT_TIMEOUT_MS)"],
  ["const timeoutMs = opts.timeoutMs ?? 15_000", "const timeoutMs = opts.timeoutMs ?? PREKEY_DEFAULT_TIMEOUT_MS"],
])
edit('FakeWaServer.ts', [
  [
    "public awaitPreKeyBundle(timeoutMs = 15_000): Promise<ClientPreKeyBundle> {",
    "// ZAPO_BENCH_PREKEY_TIMEOUT_MS: the default is the dispenser's (it reads the env var); an undefined argument takes it.\n    public awaitPreKeyBundle(timeoutMs?: number): Promise<ClientPreKeyBundle> {",
  ],
])
