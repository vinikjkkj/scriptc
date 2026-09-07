/* memrig — the settled-RSS instrument for tests/perf/zapo-rest.
 *
 *   node --import tsx memrig.mts <exe> <tag> [KEY=VAL ...]
 *
 * Stands up the fake WhatsApp server, drives a compiled zapo-rest binary
 * through pairing and the whole post-login sequence WITH NO PHONE, delivers a
 * history sync of CHUNKS x CONVS x MSGS messages at TEXTLEN bytes, idles for
 * IDLE_S, and asks the service to shut itself down cleanly. Throughout, a
 * separate process samples the CHILD's kernel-side memory counters, so peak
 * and settled both fall out of one series.
 *
 * It writes, into <MEMRIG_OUT>:
 *   <tag>.rss.csv      the sampler's series          -- read by memrig-report.mjs
 *   <tag>.phases.csv   this rig's markers            -- read by memrig-report.mjs
 *   <tag>/state.sqlite the service's store           -- read by memrig-rows.mjs
 *   <tag>.client.log   the child's combined output   -- read by memrig-throughput.mjs
 *   <tag>.<census>.txt whatever censuses the binary was built with
 *
 * THE OUTPUT SHAPE IS LOAD-BEARING. memrig-report.mjs is written against the
 * five-column sampler CSV and the `ms,phase` markers below, and an earlier
 * mismatch between the two ends made it drop every row of every real run and
 * report "0 SAMPLES". Read that reader before changing anything here.
 *
 * -------------------------------------------------------------------------
 * WHY THIS FILE IS IN THE REPO
 *
 * It used to live in the zapo checkout, outside version control. Every settled
 * figure this project quoted -- 163.39 -> 104.50 MiB, the ~52 MiB handed back
 * to the OS, the arena-budget comparison -- was taken with it, and when the
 * worktree that held it was purged the numbers became real but unreproducible.
 * The three readers survived precisely because they were committed. The driver
 * is the instrument; it lives here now.
 *
 * -------------------------------------------------------------------------
 * ENVIRONMENT
 *
 *   ZAPO_FAKE_SERVER  (required) path to the zapo checkout's fake-server
 *                     package, or to the zapo root that contains
 *                     packages/fake-server. Nothing is vendored: the fake
 *                     server is zapo's, it is read-only to us, and a copy in
 *                     this repo would drift from the protocol it fakes.
 *   MEMRIG_OUT        run directory (default: ./memrig-run beside this file)
 *   MEMRIG_PMON       the sampler (default: pmon.exe beside this file)
 *
 * -------------------------------------------------------------------------
 * KNOBS -- passed as KEY=VAL arguments, or as environment
 *
 *   CHUNKS 8   CONVS 400   MSGS 6   TEXTLEN 300     the documented workload
 *   ROUNDS 1         deliver the whole payload this many times
 *   IDLE_S 60        idle after the last round, marked every 30 s
 *   SAMPLE_MS 250    sampler cadence
 *   SETTLE_MS 45000  quiet time after a round before SETTLED-r<n> is marked
 *   PRESYNC_MS 20000 quiet time after login before PRESYNC-BASELINE
 *   SHUTDOWN_WAIT_MS 30000
 *
 * Any other KEY=VAL is passed straight to the child, which is how an env-gated
 * arm (SCR_CYCLE_ARENA_BUDGET=...) is measured on the SAME executable as its
 * control.
 *
 * ONE SOURCE FOR A KNOB. An ancestor of this rig read the payload dials out of
 * process.env while the ARM lines it recorded read the argument list, so
 * `rig tag CHUNKS=2` recorded CHUNKS=2 and ran CHUNKS=8: the arm record
 * disagreed with the workload and nothing said so. N() below is the only
 * reader of either, and the ARM lines are written through the same precedence.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, createWriteStream, appendFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELF = '5511920387975'

const [, , exe, tag, ...envArgs] = process.argv
if (!exe || !tag) {
    console.error('usage: node --import tsx memrig.mts <exe> <tag> [KEY=VAL ...]')
    process.exit(2)
}
if (!existsSync(exe)) { console.error(`memrig: no such binary ${exe} — could not look`); process.exit(2) }

const extraEnv: Record<string, string> = Object.fromEntries(
    envArgs.map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)] }))
const N = (k: string, d: number) => Number(extraEnv[k] ?? process.env[k] ?? d)

const CHUNKS = N('CHUNKS', 8), CONVS = N('CONVS', 400), MSGS = N('MSGS', 6)
const TEXTLEN = N('TEXTLEN', 300), IDLE_S = N('IDLE_S', 60), SAMPLE_MS = N('SAMPLE_MS', 250)
const ROUNDS = N('ROUNDS', 1), SETTLE_MS = N('SETTLE_MS', 45000), PRESYNC_MS = N('PRESYNC_MS', 20000)
const SHUTDOWN_WAIT_MS = N('SHUTDOWN_WAIT_MS', 30000)

const OUT = resolve(process.env.MEMRIG_OUT ?? join(HERE, 'memrig-run'))
const PMON = resolve(process.env.MEMRIG_PMON ?? join(HERE, 'pmon.exe'))
if (!existsSync(PMON)) {
    console.error(`memrig: no sampler at ${PMON}. Build it:\n` +
        `  zig cc -O2 -o ${PMON} ${join(HERE, 'pmon.c')} -lpsapi`)
    process.exit(2)
}

/* The fake server is zapo's and is loaded from the zapo checkout by path.
 * A static import would bake a checkout location into a committed file, which
 * is a version of the mistake that lost this rig's ancestor. */
const fsRootRaw = process.env.ZAPO_FAKE_SERVER
if (!fsRootRaw) {
    console.error('memrig: set ZAPO_FAKE_SERVER to the zapo checkout fake-server package\n' +
        '        (or to the zapo root containing packages/fake-server)')
    process.exit(2)
}
let FS_ROOT = resolve(fsRootRaw)
if (!existsSync(join(FS_ROOT, 'src'))) {
    const nested = join(FS_ROOT, 'packages', 'fake-server')
    if (existsSync(join(nested, 'src'))) FS_ROOT = nested
    else {
        console.error(`memrig: ${FS_ROOT} has no src/ and no packages/fake-server/src — could not look`)
        process.exit(2)
    }
}
/* THE LAUNCH DIRECTORY IS PART OF THE PROTOCOL, and the README that described
 * this rig never said so.
 *
 * fake-server's sources import `zapo-js/util`, `zapo-js/crypto` and friends.
 * Those are not node_modules packages: they are tsconfig `paths` entries in the
 * ZAPO ROOT's tsconfig.json, mapped against `baseUrl: "."`. tsx picks the
 * tsconfig up from the directory the process was LAUNCHED in, at --import
 * registration time — before a line of this file runs. Measured: calling
 * process.chdir() here does not help, the import still fails with
 * "Cannot find module 'zapo-js/util'". So the rig cannot fix this for you; it
 * can only refuse to produce a number it could not have measured.
 *
 * Run it with the zapo root as the working directory. */
const ZAPO_ROOT = resolve(FS_ROOT, '..', '..')
if (resolve(process.cwd()).toLowerCase() !== ZAPO_ROOT.toLowerCase()) {
    console.error(
        `memrig: run this from the zapo root, not ${process.cwd()}\n` +
        `        cd ${ZAPO_ROOT}\n` +
        `  fake-server resolves zapo-js/* through that directory's tsconfig "paths",\n` +
        `  and tsx reads the tsconfig from the LAUNCH cwd. chdir() here is too late.\n` +
        `  Set MEMRIG_ALLOW_ANY_CWD=1 only if you have arranged the resolution some\n` +
        `  other way — a failure here is a failure to measure, not a zero.`)
    if (!process.env.MEMRIG_ALLOW_ANY_CWD) process.exit(2)
}
const imp = (rel: string) => import(pathToFileURL(join(FS_ROOT, 'src', rel)).href)
const { FakeWaServer } = await imp('api/FakeWaServer')
const { parsePairingQrString } = await imp('protocol/auth/pair-device')
const { buildAppStateSyncKeyShareMessage } = await imp('protocol/push/app-state-key-share')
const { bytesToHex } = await imp('transport/util')

const PORT = 19000 + Math.floor(Math.random() * 900)
const RUN = join(OUT, tag)
rmSync(RUN, { recursive: true, force: true })
mkdirSync(RUN, { recursive: true })
const CSV = join(OUT, `${tag}.rss.csv`), PH = join(OUT, `${tag}.phases.csv`)

/* The ARM lines record what this run actually was. They carry ms=0 so the
 * reader's header drop and its time arithmetic both leave them alone, and they
 * are written through the SAME precedence the workload used. */
writeFileSync(PH, 'ms,phase\n')
for (const k of ['SCR_HEAP_TRIM_MS', 'SCR_HEAP_TRIM_STAT', 'SCR_HEAP_TRIM_CENSUS',
    'SCR_FIBER_POOL_DECAY_MS', 'SCR_CYCEN_OUT', 'SCR_STRING_ARENA', 'SCR_CYCLE_ARENA',
    'SCR_CYCLE_ARENA_BUDGET', 'SCR_STRING_INTERN', 'ZAPO_SQLITE_CACHE_KB', 'ZAPO_EVENT_BUFFER',
    'CHUNKS', 'CONVS', 'MSGS', 'TEXTLEN', 'ROUNDS', 'IDLE_S']) {
    const v = extraEnv[k] ?? process.env[k]
    if (v !== undefined) appendFileSync(PH, `0,ARM ${k}=${v}\n`)
}
const clog = createWriteStream(join(OUT, `${tag}.client.log`))
const phase = (p: string) => { appendFileSync(PH, `${Date.now()},${p}\n`); process.stdout.write(`  [phase] ${p}\n`) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
    const server = await FakeWaServer.start({ host: '127.0.0.1', port: 0, path: '/ws/chat' })
    /* A realistic ab-props blob: the client parses and retains it, and a rig
     * that sent an empty one would understate the presync baseline. */
    server.setAbProps({
        hash: '186', refreshSeconds: 92216, refreshId: 186,
        props: Array.from({ length: 1654 }, (_, i) => ({ configCode: 1000 + i, configValue: i % 29 === 0 ? 'on' : 'off' }))
    })

    let resolveQr!: (s: string) => void
    const qrPromise = new Promise<string>((r) => { resolveQr = r })
    let paired = false, loggedIn = false
    let resolveLogin!: (p: unknown) => void
    const loginPromise = new Promise<any>((r) => { resolveLogin = r })

    /* No phone. The registration pipeline is answered by parsing the QR the
     * binary prints on stdout and completing the pairing handshake from here;
     * the binary then reconnects as a login pipeline like a real client. */
    server.onAuthenticatedPipeline(async (pipeline: any) => {
        if (pipeline.clientPayload?.kind === 'registration' && !paired) {
            paired = true
            await server.runPairing(pipeline, { deviceJid: `${SELF}:63@s.whatsapp.net` }, async () => {
                const p = parsePairingQrString((await qrPromise).trim())
                return { advSecretKey: p.advSecretKey, identityPublicKey: p.identityPublicKey }
            })
            phase('pair-success-sent'); return
        }
        if (pipeline.clientPayload?.kind === 'login' && !loggedIn) { loggedIn = true; resolveLogin(pipeline) }
    })

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        ZAPO_REST_HOST: '127.0.0.1', ZAPO_REST_PORT: String(PORT),
        ZAPO_DB: join(RUN, 'state.sqlite'), ZAPO_SESSION: 'drive', ZAPO_AUTOCONNECT: '1',
        /* the clean-exit route; see the shutdown block at the end */
        ZAPO_REST_ALLOW_SHUTDOWN: '1',
        SCR_CYCEN_OUT: join(OUT, `${tag}.cycen.txt`),
        SCR_PROF_OUT: join(OUT, `${tag}.prof.txt`),
        SCR_HEAPCEN_OUT: join(OUT, `${tag}.heapcen.txt`),
        SCR_CYCSTAT_OUT: join(OUT, `${tag}.cycstat.txt`),
        SCR_STRCEN_OUT: join(OUT, `${tag}.strcen.txt`),
        SCR_DYNCEN_OUT: join(OUT, `${tag}.dyncen.txt`),
        ZAPO_WS_URL: server.url, ZAPO_WS_CA_PUB: bytesToHex(server.noiseRootCa.publicKey),
        ZAPO_WS_CA_SERIAL: String(server.noiseRootCa.serial),
        ...extraEnv
    }
    console.log(`[${tag}] ${server.url}  out=${OUT}`)
    console.log(`[${tag}] payload: ${ROUNDS}x ${CHUNKS} chunks x ${CONVS} convs x ${MSGS} msgs x ${TEXTLEN}B, idle ${IDLE_S}s`)

    phase('client-spawn')
    const client = spawn(exe, [], { cwd: RUN, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const pid = client.pid!

    /* The sampler is a SEPARATE PROCESS reading the child's counters through
     * the kernel. In-process instrumentation cannot see what the binary has
     * returned to the OS versus what it still owns, and that difference is the
     * entire subject of the settled measurement. */
    const sampler = spawn(PMON, [String(pid), String(SAMPLE_MS), CSV], { stdio: 'inherit' })

    let buf = '', decoded = 0
    let resolveDone!: () => void
    const donePromise = new Promise<void>((r) => { resolveDone = r })
    void donePromise
    const onOut = (d: Buffer) => {
        const s = d.toString(); clog.write(s); buf += s
        let i
        while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); line(l) }
    }
    client.stdout.on('data', onOut); client.stderr.on('data', onOut)
    function line(l: string) {
        const q = l.indexOf('[qr] ')
        if (q >= 0 && !l.includes('ttlMs=') && l.split(',').length >= 5) resolveQr(l.slice(q + 5))
        if (l.includes('[connection] open') || l.includes('wa client connected')) phase('client-registered-login')
        if (l.includes('uploaded prekeys')) phase('prekeys-uploaded')
        if (l.includes('decoded history sync chunk')) { decoded++; phase(`chunk-decoded-${decoded}`); if (decoded >= CHUNKS * ROUNDS) resolveDone() }
        /* A refusal is recorded as a phase so a run that measured a crippled
         * binary cannot be read as a clean memory result. */
        if (/SC\d{4}/.test(l)) phase(`REFUSAL:${l.slice(0, 80)}`)
    }

    const pipeline = await loginPromise
    phase('login-pipeline')
    const self = await server.createFakePeer({ jid: `${SELF}@s.whatsapp.net` }, pipeline)
    /* The app-state key share is part of the real post-login sequence; without
     * it the client keeps retrying and the baseline never goes quiet. */
    const keys = Array.from({ length: 9 }, () => ({
        keyId: new Uint8Array(randomBytes(16)), keyData: new Uint8Array(randomBytes(32)),
        fingerprint: { rawId: 0, currentIndex: 0, deviceIndexes: [] as number[] }, timestamp: Date.now()
    }))
    for (const k of keys) server.registerAppStateSyncKey(k.keyId, k.keyData)
    await self.sendMessage(buildAppStateSyncKeyShareMessage({ keys } as any))

    /* Let the post-login burst settle, so PRESYNC is a real baseline and the
     * climb attributed to the sync is the sync's. */
    await sleep(PRESYNC_MS)
    phase('PRESYNC-BASELINE')

    const text = 'x'.repeat(TEXTLEN)
    for (let round = 1; round <= ROUNDS; round++) {
        phase(`ROUND-${round}-START`)
        for (let c = 1; c <= CHUNKS; c++) {
            /* Fresh ids every run and every round: the store upserts on
             * (session_id, message_id), so reused ids would silently collapse
             * rows and memrig-rows.mjs would report a clean, wrong total. */
            const conversations = Array.from({ length: CONVS }, (_, i) => ({
                id: `55119${String(100000 + round * 200000 + c * 1000 + i)}@s.whatsapp.net`,
                name: `Contact ${c}-${i}`, unreadCount: i % 7,
                messages: Array.from({ length: MSGS }, (_, m) => ({
                    id: `3A${c}${i}${m}${randomBytes(6).toString('hex').toUpperCase()}`,
                    fromMe: m % 2 === 0, timestamp: Math.floor(Date.now() / 1000) - m * 60,
                    message: { conversation: `${text} c${c} i${i} m${m}` }
                }))
            }))
            await self.sendHistorySync({
                chunkOrder: c, progress: Math.round((c / CHUNKS) * 100),
                conversations: conversations as any
            })
            phase(`chunk-sent-${c}`)
        }
        phase(`all-chunks-sent-r${round}`)
        const want = round * CHUNKS
        for (let w = 0; w < 180 && decoded < want; w++) await sleep(1000)
        phase(`SYNC-DONE-r${round}`)
        /* Settle, so the reading is retention and not a transient. This wait is
         * the definition of "settled" the README quotes; it is a knob so a
         * longer one can be shown to change nothing. */
        await sleep(SETTLE_MS)
        phase(`SETTLED-r${round}`)
    }
    for (let s = 30; s <= IDLE_S; s += 30) { await sleep(30000); phase(`IDLE-${s}s`) }
    phase('END')

    /* The service's own event ring, fetched WHILE THE CHILD IS STILL ALIVE --
     * this is the only window in which it can be read at all, and it is what
     * memrig-throughput.mjs consumes. The `history_sync_chunk` event fires
     * after a chunk's writes are flushed, so its `at` is the chunk's real
     * completion; the "decoded history sync chunk" log line this rig counts is
     * the decode START and says nothing about the write.
     *
     * THE RIG THIS ONE WAS REBUILT FROM DID NOT DO THIS. It wrote the sampler
     * CSV and the phase markers, so memrig-report.mjs and memrig-rows.mjs both
     * worked, and memrig-throughput.mjs could never read a single run -- there
     * is no .events.json anywhere in the preserved output of any arm. The
     * out-of-order-progress finding in the README was therefore taken by some
     * other means and is not reproducible from the rig's own artefacts. It is
     * reproducible from this one. */
    const evf = join(OUT, `${tag}.events.json`)
    try {
        const limit = CHUNKS * ROUNDS + 50
        const res = await fetch(
            `http://127.0.0.1:${PORT}/events?type=history_sync_chunk&since=0&limit=${limit}`)
        const body = await res.text()
        writeFileSync(evf, body)
        let n = -1
        try {
            const j = JSON.parse(body)
            const arr = Array.isArray(j) ? j : (j.result ?? j.events ?? null)
            n = Array.isArray(arr) ? arr.length : -1
        } catch { /* the reader will report the shape it got */ }
        phase(`events-captured ${res.status} n=${n}`)
        /* Silence here would be indistinguishable from a healthy run whose
         * ring was empty, and an empty ring is not a pass. */
        if (n !== CHUNKS * ROUNDS) {
            phase(`events-COUNT-MISMATCH want=${CHUNKS * ROUNDS} got=${n}`)
        }
    } catch (e) {
        phase(`events-fetch-failed ${String(e).slice(0, 120)}`)
    }

    /* A CLEAN EXIT, not a SIGKILL. Every allocation census under tests/perf
     * writes from atexit or from an _Exit interposer, so a killed child leaves
     * the settled heap measurable in aggregate but never attributable. The
     * /shutdown route is the route added for this; the fallback kill stays so a
     * build without the route, or a wedged process, cannot hang the rig. */
    const exited: Promise<number | null> = new Promise((r) => client.on('exit', (c) => r(c)))
    let outcome: number | null | 'timeout' | 'error' = 'error'
    try {
        const res = await fetch(`http://127.0.0.1:${PORT}/shutdown`, { method: 'POST' })
        phase(`shutdown-requested ${res.status} ${(await res.text()).slice(0, 120)}`)
        outcome = await Promise.race([exited, sleep(SHUTDOWN_WAIT_MS).then(() => 'timeout' as const)])
    } catch (e) {
        phase(`shutdown-failed ${String(e).slice(0, 120)}`)
    }
    if (typeof outcome === 'number') phase(`clean-exit code=${outcome}`)
    else {
        phase(`shutdown-fallback-kill (${String(outcome)})`)
        try { client.kill('SIGKILL') } catch { /* already gone */ }
    }
    /* Give the sampler a cadence to notice the exit and flush its tail. */
    await sleep(Math.max(1000, SAMPLE_MS * 2))
    try { sampler.kill('SIGKILL') } catch { /* already gone */ }
    await server.stop().catch(() => {})
    console.log(`[${tag}] done — read it with:\n` +
        `  node ${join(HERE, 'memrig-report.mjs')} ${OUT} ${tag}`)
    process.exit(0)
}

main().catch((e) => { console.error('RIG ERROR', e); process.exit(1) })
