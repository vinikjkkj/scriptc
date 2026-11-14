/* ladder-notrace.mjs (zapobench): remove the ZAPO_BENCH_TRACE_QUERIES wrapper from _store-factory.ts's kept postgres/mysql arm.
 * The wrapper is DEAD at run time (ZAPO_BENCH_TRACE_QUERIES is unset in every arm, both lanes), but it is compiled, and the current
 * compiler refuses two things in it:
 *   SC2020 'process.hrtime.bigint' has no scriptc lowering   (_store-factory.ts:155:34 in the mysql arm)
 *   SC1090 a Proxy target that is a statically-typed record value (_store-factory.ts:164:21)
 * Both are recorded as OPEN compiler defects in the report; this patch only removes the dead code so the live path can be measured.
 * argv[2] = bench dir, env KEEP = postgres|mysql. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const f = join(process.argv[2], '_store-factory.ts'); const t = readFileSync(f, 'utf8'); const L = t.split('\n')
const keep = process.env.KEEP
const fn = keep === 'postgres' ? 'buildPostgresStore' : keep === 'mysql' ? 'buildMysqlStore' : null
if (!fn) process.exit(0)
const s = L.findIndex((l) => l.startsWith(`async function ${fn}(`)); if (s < 0) { console.error('no fn'); process.exit(4) }
let e = -1; for (let i = s + 1; i < L.length; i++) if (L[i] === '}') { e = i; break }
const body = L.slice(s, e + 1)
const a = body.findIndex((l) => l.startsWith('    const trace = process.env.ZAPO_BENCH_TRACE_QUERIES'))
const b = body.findIndex((l) => l.startsWith('    const backend = create'))
if (a < 0 || b < 0 || b < a) { console.error('trace head not found'); process.exit(5) }
body.splice(a, b - a, '    const pool = rawPool')
const c = body.findIndex((l) => l === '            if (trace) {')
const d = body.findIndex((l) => l.startsWith('            await rawPool.') && l.includes('end()') || l.startsWith('            await rawClient'))
if (c < 0 || d < 0 || d < c) { console.error('trace tail not found'); process.exit(6) }
body.splice(c, d - c)
const out = [...L.slice(0, s), ...body, ...L.slice(e + 1)].join('\n')
if (/hrtime|new Proxy|\btrace\b/.test(body.join('\n'))) { console.error('self-test: trace residue'); process.exit(7) }
if (!body.join('\n').includes('rawPool.end()')) { console.error('self-test: teardown lost'); process.exit(8) }
writeFileSync(f, out); console.log(`notrace: ${fn} ${L.length} -> ${out.split('\n').length} lines`)
