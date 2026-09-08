/* ladder-mexprobe.mjs — make the bench drive the mex/argo path.
 *
 *   node ladder-mexprobe.mjs <bench-dir>
 *
 * The argo fences that --npm-static argo-codec puts inside argo-codec's own
 * CJS were UNFIRED and UNMEASURED, because zapo's messaging bench never issues
 * a mex query and the fake server has never answered one. This rung closes
 * that, and it closes it WITHOUT editing zapo:
 *
 *  SERVER (stays Node, is never compiled): FakeWaServer exposes
 *  `registerIqHandler(matcher, respond, label)` as a public extension point --
 *  its own header says a caller may "wire every response via
 *  registerIqHandler". The bench's server-process.ts, which is already a
 *  per-bench-dir copy, registers a `w:mex` handler that answers with
 *  `<result format="argo">` carrying bytes produced by argo-codec's OWN
 *  encoder. Nothing under fake-server/src is touched, so every other bench dir
 *  is unaffected.
 *
 *  CLIENT (compiles): `client.message.getReachoutTimelock()` is public zapo
 *  API. It reaches runMexQuery -> parseMexResultPayload -> the argo branch.
 *  No internal import, no reach-around.
 *
 * The payload is the shape parseReachoutTimelockMexResponse expects, so a
 * correct decode is observable as VALUES and not merely as "no throw".
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (dir === undefined) { console.error('usage: ladder-mexprobe.mjs <bench-dir>'); process.exit(2) }

/* ---------- server half ---------- */
const sp = join(dir, 'server-process.ts')
const spText = readFileSync(sp, 'utf8')
if (spText.includes('\r')) { console.error('CRLF; refusing to rewrite line endings'); process.exit(3) }
if (spText.includes('mex-argo-probe')) { console.error('server already has the mex-argo probe handler'); process.exit(4) }

const START = '    server = await FakeWaServer.start()'
if (!spText.includes(START)) { console.error('server start site not found'); process.exit(5) }

const SERVER_PATCH = `${START}
    // --- mex/argo probe (test scaffolding, NOT zapo) -------------------
    // Registered through FakeWaServer's own public extension point, so no
    // file under fake-server/src changes and no other bench dir is affected.
    // The bytes come from argo-codec's REAL encoder, so this is a genuine
    // cross-implementation exercise of zapo's hand-written argo decoder.
    {
        const { encode } = (await import('argo-codec')) as unknown as {
            encode: (w: unknown, v: unknown, o?: unknown) => Uint8Array
        }
        const payload = encode({ type: 'DESC' }, {
            xwa2_fetch_account_reachout_timelock: {
                is_active: true,
                enforcement_type: 'SOFT_BLOCK',
                time_enforcement_ends: 1767225600
            }
        })
        server.registerIqHandler(
            { xmlns: 'w:mex', type: 'get', childTag: 'query' },
            (iq: { attrs: Record<string, string> }) => ({
                tag: 'iq',
                attrs: { type: 'result', id: iq.attrs.id, from: 's.whatsapp.net' },
                content: [{ tag: 'result', attrs: { format: 'argo' }, content: payload }]
            }),
            'mex-argo-probe'
        )
        console.log('[mex-probe] server registered w:mex handler, ' + payload.length + 'B argo payload')
    }
    // ------------------------------------------------------------------`
writeFileSync(sp, spText.replace(START, SERVER_PATCH))

/* ---------- client half ---------- */
const mb = join(dir, 'messaging.bench.ts')
const mbText = readFileSync(mb, 'utf8')
if (mbText.includes('\r')) { console.error('CRLF in bench; refusing'); process.exit(3) }
if (/getReachoutTimelock\(/.test(mbText)) { console.error('bench already drives mex'); process.exit(4) }

const lines = mbText.split('\n')
const iConn = lines.findIndex((l) => l.trim() === 'await client.connect()')
if (iConn < 0) { console.error('no `await client.connect()` in the bench'); process.exit(6) }
const ind = ' '.repeat(lines[iConn].length - lines[iConn].trimStart().length)
lines.splice(iConn + 1, 0,
  `${ind}// --- mex/argo probe (test scaffolding, NOT zapo) ---`,
  `${ind}// Public zapo API. Reaches runMexQuery -> parseMexResultPayload ->`,
  `${ind}// the format === 'argo' branch -> decodeMexArgoResponse.`,
  `${ind}// zapo's loadArgo() swallows the module-load error into \`null\`, so a`,
  `${ind}// failure downstream always reads "'argo-codec' not installed" whatever`,
  `${ind}// the real cause was. This line asks the SAME question directly and`,
  `${ind}// prints the answer, so a THREW result below can be attributed to the`,
  `${ind}// module refusal or to a fence firing during module init, rather than`,
  `${ind}// being ambiguous between them. Test scaffolding, not zapo.`,
  `${ind}try {`,
  `${ind}    const m = (await import('argo-codec')) as unknown as { Reader?: unknown }`,
  `${ind}    console.log('[mex-probe] import(argo-codec) OK, Reader=' + typeof m.Reader)`,
  `${ind}} catch (err) {`,
  `${ind}    console.log('[mex-probe] import(argo-codec) FAILED: ' + (err as Error).message)`,
  `${ind}}`,
  `${ind}try {`,
  `${ind}    const tl = await client.message.getReachoutTimelock()`,
  `${ind}    console.log('[mex-probe] OK isActive=' + String(tl.isActive) +`,
  `${ind}        ' enforcementType=' + String(tl.enforcementType) +`,
  `${ind}        ' enforcementEndsAt=' + String(tl.enforcementEndsAt))`,
  `${ind}} catch (err) {`,
  `${ind}    console.log('[mex-probe] THREW ' + (err as Error).message)`,
  `${ind}}`,
  `${ind}// ---------------------------------------------------`)
const out = lines.join('\n')

/* Self-test: both halves must have fired, and the bench must still be the bench. */
if (!readFileSync(sp, 'utf8').includes('mex-argo-probe')) { console.error('self-test: server half did not apply'); process.exit(7) }
const nProbe = (out.match(/getReachoutTimelock\(\)/g) ?? []).length
const nImp = (out.match(/import\('argo-codec'\)/g) ?? []).length
if (nProbe !== 1 || nImp !== 1) { console.error(`self-test: ${nProbe} mex call(s) and ${nImp} direct import(s), expected 1 and 1`); process.exit(7) }
for (const k of ['mainSeparateProcess', 'scenarioSend1to1', 'scenarioRecvGroup', 'WaClient', 'console.log(`[phase-begin]']) {
  if (!out.includes(k)) { console.error(`self-test: '${k}' was removed and must not be`); process.exit(8) }
}
if (out.length <= mbText.length) { console.error('self-test: bench did not grow'); process.exit(9) }
writeFileSync(mb, out)
console.log(`mex probe: server handler registered; client calls getReachoutTimelock() after connect (${mbText.split('\n').length} -> ${lines.length} lines)`)
