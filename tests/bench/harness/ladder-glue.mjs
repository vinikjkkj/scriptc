/* ladder-glue.mjs (zapobench): the two rewrites the current compiler forced, each semantics-preserving. argv[2] = bench dir.
 *  1. messaging.bench.ts snapshotMemory(): process.memoryUsage() -> process.memoryUsage.rss() + heap 0.
 *     SC2020 at messaging.bench.ts:282 (heap fields have no meaning without V8). Applied to BOTH lanes (same source); the bench's
 *     "heap delta" column therefore reads 0.00 on both lanes, exactly as in the clientbench prior art. RSS comes from outside anyway.
 *  2. rpc-frame.ts (OUR transport file, not zapo's): Uint8Array.from(view) -> explicit copy. SC2020 at rpc-frame.ts:98
 *     ('Uint8Array.from' has no scriptc lowering). A copy either way; compiler defect recorded in the report. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = process.argv[2]
function rep(file, from, to) {
  const p = join(dir, file); const t = readFileSync(p, 'utf8')
  if (!t.includes(from)) { console.error(`ladder-glue: pattern not found in ${file}`); process.exit(4) }
  if (t.split(from).length !== 2) { console.error(`ladder-glue: pattern not unique in ${file}`); process.exit(5) }
  writeFileSync(p, t.replace(from, to))
}
rep('messaging.bench.ts', `    const m = process.memoryUsage()\n    return { rss: m.rss, heap: m.heapUsed }`, `    // zapobench: heap fields are V8 statistics; only rss exists in both lanes\n    return { rss: process.memoryUsage.rss(), heap: 0 }`)
rep('rpc-frame.ts', `                blobs.push(Uint8Array.from(body.subarray(off, off + len)))`, `                const copy = new Uint8Array(len)\n                copy.set(body.subarray(off, off + len))\n                blobs.push(copy)`)
/* 3. MEASUREMENT-ONLY, both lanes: drop WaClient's `proxy: {mediaUpload, mediaDownload}` option (messaging never issues a media request).
 *    Reason: a compiled https.Agent has no addRequest(), so zapo refuses the option at construction ("proxy.mediaUpload must be a proxy
 *    transport instance"). OPEN COMPILER DEFECT (repro: app/probe/agent.ts): this is a worked-around divergence, not a fix. */
rep('messaging.bench.ts', `            proxy: {\n                mediaUpload: rpc.mediaProxyAgent!,\n                mediaDownload: rpc.mediaProxyAgent!\n            },\n`, ``)
console.log('glue applied')
