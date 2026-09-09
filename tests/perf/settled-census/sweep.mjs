/* sweep.mjs - what drives the 1,344 B free-hole class.
 *
 *   node tests/perf/settled-census/sweep.mjs [--size 1344] [--dir <evidence-sweep>]
 *
 * The settled census found ONE population carrying 57.3% of the free space:
 * 1,344 bytes, 15,766 holes, 20.21 MiB, none of them live. It is on none of
 * the three ladders that were registered before the reading -- not the
 * entries array (24*2^n; scr_json.c has exactly one entries allocation site
 * and it is the doubling path, so cap is always a power of two), not
 * scr_arr_grow (cap*8 from 4, exact powers of two), and above the 244..511
 * band. So the size alone could not name it and the workload had to.
 *
 * These four runs are one binary with the rig's knobs moved, which needs no
 * build and no guess. Each row is read from that run's own HCFREE table and
 * its own ARM lines, so the workload a row claims is the workload memrig
 * recorded rather than the one someone meant to set.
 *
 * WHAT THEY SETTLE:
 *
 *   TEXTLEN 300 -> 900 moves NOTHING (37 holes vs 36, same size). The class
 *   is not derived from the message body, which kills the string
 *   hypothesis: 8*ceil((cap+13)/8) = 1344 needs cap in 1324..1331, and a
 *   body-derived string of that width would have tripled with TEXTLEN.
 *
 *   The SAME message count gives 6,042 holes at 4 chunks and 15,597 at 8.
 *   And 8 chunks gives ~15,600 whether the run carries 9,600 messages or
 *   19,200. The class tracks CHUNKS -- roughly 1,500-2,000 blocks per
 *   history-sync chunk -- and is nearly independent of how many messages or
 *   conversations a chunk contains.
 *
 * That is a scaling law, not an attribution. It says the allocation is
 * per-chunk machinery rather than per-message payload, and it is what the
 * stack trace has to be consistent with.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d }
const SIZE = Number(arg('size', 1344))
const DIR = arg('dir', join(HERE, 'evidence-sweep'))
const EXTRA = [join(HERE, 'evidence-llvm182', 'main'), join(HERE, 'evidence-llvm182', 'nosync')]

function read(dir) {
  const hc = ['heapcen.txt', 'n1.heapcen.txt'].map((f) => join(dir, f)).find(existsSync)
  const ph = ['phases.csv', 'n1.phases.csv'].map((f) => join(dir, f)).find(existsSync)
  if (!hc || !ph) return null
  const H = readFileSync(hc, 'utf8'), P = readFileSync(ph, 'utf8')
  /* No regex: memrig writes one ARM line per knob as `0,ARM NAME=VALUE`,
   * and a plain scan cannot be broken by a shell eating a backslash. The
   * previous spelling was a RegExp built from a string literal, lost one
   * backslash to a heredoc, and silently matched nothing. */
  const knob = (k) => {
    for (const l of P.split(/[\r]?[\n]/)) {
      const i = l.indexOf('ARM ' + k + '=')
      if (i >= 0) { const v = Number(l.slice(i + 5 + k.length)); return Number.isFinite(v) ? v : null }
    }
    return null
  }
  let holes = 0, freeBytes = 0
  for (const l of H.split(/\r?\n/)) {
    const m = l.match(/^HCFREE (\d+) (\d+) (\d+)/)
    if (!m) continue
    freeBytes += Number(m[3])
    if (Number(m[1]) === SIZE) holes = Number(m[2])
  }
  const ch = knob('CHUNKS'), cv = knob('CONVS'), ms = knob('MSGS'), tl = knob('TEXTLEN')
  const gap = knob('CHUNK_GAP_MS') ?? 0
  return { dir, ch, cv, ms, tl, gap, msgs: (ch ?? 0) * (cv ?? 0) * (ms ?? 0), holes, freeBytes }
}

const dirs = [...(existsSync(DIR) ? readdirSync(DIR).map((d) => join(DIR, d)) : []), ...EXTRA]
/* Split on either separator without writing a backslash into a pattern:
 * normalise first, then split on '/'. A character class built from a string
 * is where the last one of these went wrong. */
const shortName = (p) => p.split(String.fromCharCode(92)).join('/').split('/').slice(-2).join('/')
const rows = dirs.map(read).filter(Boolean).sort((a, b) => a.msgs - b.msgs || a.ch - b.ch)
if (!rows.length) { console.error('no evidence under ' + DIR); process.exit(2) }

console.log('what drives the ' + SIZE + ' B free-hole class\n')
console.log('  run                chunks  convs  msgs/conv  messages   holes@' + SIZE + '   freeMiB')
for (const r of rows)
  console.log('  ' + shortName(r.dir).padEnd(18) +
    String(r.ch).padStart(6) + String(r.cv).padStart(7) + String(r.ms).padStart(11) +
    String(r.msgs).padStart(10) + String(r.holes).padStart(12) +
    (r.freeBytes / 1048576).toFixed(2).padStart(10))

let fails = 0, ran = 0
const ok = (c, m) => { ran++; console.log((c ? '\n  PASS  ' : '\n  FAIL  ') + m); if (!c) fails++ }
const by = (ch, cv) => rows.find((r) => r.ch === ch && r.cv === cv)

const a = by(8, 200), b = by(4, 400)
if (a && b)
  ok(a.holes > b.holes * 2,
    'at the SAME message count (' + a.msgs + '), 8 chunks yields ' + a.holes +
    ' and 4 chunks ' + b.holes + ' — it tracks CHUNKS, not messages')
const c = by(8, 400)
if (a && c)
  ok(Math.abs(a.holes - c.holes) / c.holes < 0.15,
    '8 chunks gives ' + a.holes + ' at ' + a.msgs + ' messages and ' + c.holes +
    ' at ' + c.msgs + ' — doubling the messages moves it under 15%')
/* THE DECISIVE PAIR. Same payload, same binary; only the delivery gap
 * differs, so only CONCURRENCY differs. Per-chunk machinery would allocate
 * the same amount either way; failed recycling collapses. It collapses. */
const g0 = rows.find((r) => r.gap === 0 && r.ch === 8 && r.cv === 200)
const gN = rows.find((r) => r.gap > 0)
if (g0 && gN)
  ok(gN.holes < g0.holes / 100,
    'serialising chunk delivery collapses the class ' + g0.holes + ' -> ' + gN.holes +
    ' on an identical payload — it is stranded recycling, not an allocation site')
const z = rows.find((r) => r.ch === 0)
if (z) ok(z.holes === 0, 'the CHUNKS=0 control has none of the class at all (' + z.holes + ')')

/* A CHECKER THAT RAN NO CHECKS MUST NOT SAY OK. Every assertion here is
 * guarded on a row being found, so a parse failure skips all of them and
 * the old spelling printed a pass over an empty table. It happened. */
const MIN_CHECKS = 4
if (ran < MIN_CHECKS) {
  console.log('\n  REFUSED: only ' + ran + ' of ' + MIN_CHECKS + ' checks could run — the\n' +
    '  workload knobs did not parse, so the table above describes nothing.')
  process.exit(2)
}
console.log(fails ? '\nSWEEP FAILED (' + fails + ')' : '\nSWEEP OK — CONCURRENCY, not per-chunk machinery and not per-message payload')
process.exit(fails ? 1 : 0)
