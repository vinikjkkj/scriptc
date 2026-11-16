/* arm.mts <label> <db> <exe> [args...]  : one scenario arm of the REST app against the zapo fake server (Node, never compiled).
 * Run from the zapo root (tsx tsconfig paths) with ZAPO_FAKE_SERVER, RR_OUT, RR_APPDIR, RR_DBPORT set. Output: $RR_OUT/<label>/{http.json,stanzas.json,exit.json,app.log} */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, createWriteStream, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [label, db, exe, ...exeArgs] = process.argv.slice(2)
const OUT = join(process.env.RR_OUT!, label)
mkdirSync(OUT, { recursive: true })
const FS = resolve(process.env.ZAPO_FAKE_SERVER!)
const imp = (rel: string) => import(pathToFileURL(join(FS, 'src', rel)).href)
const { FakeWaServer } = await imp('api/FakeWaServer')
const { parsePairingQrString } = await imp('protocol/auth/pair-device')
const { buildAppStateSyncKeyShareMessage } = await imp('protocol/push/app-state-key-share')
const { bytesToHex } = await imp('transport/util')
const { encodeHistorySyncPlaintext } = await imp('protocol/push/history-sync')
const SELF = '5511920387975'
const PORT = Number(process.env.RR_PORT ?? 18800)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = createWriteStream(join(OUT, 'app.log'))
const t0 = Date.now()

const server = await FakeWaServer.start({ host: '127.0.0.1', port: 0, path: '/ws/chat' })
server.setAbProps({ hash: '186', refreshSeconds: 92216, refreshId: 186,
    props: Array.from({ length: 40 }, (_, i) => ({ configCode: 1000 + i, configValue: i % 3 === 0 ? 'on' : 'off' })) })
const stanzas: any[] = []
const strip = (n: any): any => ({ tag: n.tag, attrs: Object.fromEntries(Object.entries(n.attrs ?? {}).sort()),
    content: Array.isArray(n.content) ? n.content.map(strip) : (n.content instanceof Uint8Array ? `bytes(${n.content.length})` : n.content) })
server.onCapturedStanza((n: any) => { try { stanzas.push(strip(n)) } catch { stanzas.push({ err: 'strip' }) } })

let resolveQr!: (s: string) => void
const qrP = new Promise<string>((r) => { resolveQr = r })
let paired = false, loggedIn = false
let resolveLogin!: (p: any) => void
const loginP = new Promise<any>((r) => { resolveLogin = r })
server.onAuthenticatedPipeline(async (pipeline: any) => {
    if (pipeline.clientPayload?.kind === 'registration' && !paired) {
        paired = true
        await server.runPairing(pipeline, { deviceJid: `${SELF}:63@s.whatsapp.net` }, async () => {
            const p = parsePairingQrString((await qrP).trim())
            return { advSecretKey: p.advSecretKey, identityPublicKey: p.identityPublicKey }
        })
        return
    }
    if (pipeline.clientPayload?.kind === 'login' && !loggedIn) { loggedIn = true; resolveLogin(pipeline) }
})

const env: NodeJS.ProcessEnv = { ...process.env,
    ZAPO_REST_HOST: '127.0.0.1', ZAPO_REST_PORT: String(PORT), ZAPO_SESSION: 'drive', ZAPO_AUTOCONNECT: '1',
    ZAPO_REST_ALLOW_SHUTDOWN: '1', ZAPO_MYSQL_PORT: process.env.RR_DBPORT ?? '33306', ZAPO_MYSQL_DATABASE: db,
    ZAPO_WS_URL: server.url, ZAPO_WS_CA_PUB: bytesToHex(server.noiseRootCa.publicKey),
    ZAPO_WS_CA_SERIAL: String(server.noiseRootCa.serial) }
// RR_HS_MODE=external: the app downloads the history blob over HTTPS from the fake media server, whose certificate (CN=fake-media.local, no SAN, self-signed) the REST app does not trust and whose host is
// 127.0.0.1. The harness gives the app process the certificate as an extra CA (NODE_EXTRA_CA_CERTS, read by Node and by the compiled runtime alike) and sends the blob URL with the host fake-media.local
// (rest-run.mjs maps it to 127.0.0.1 in /etc/hosts). The certificate is READ from the fake server's source file; neither the server nor the app is edited.
if ((process.env.RR_HS_MODE ?? '') === 'external' || (process.env.RR_SCENARIO ?? '') === 'sweep') {
    const src = readFileSync(join(FS, 'src/infra/WaFakeMediaHttpsServer.ts'), 'utf8')
    const m = src.match(/FAKE_MEDIA_TLS_CERT_PEM = `(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/)
    if (!m) throw new Error('media certificate not found in the fake server source')
    writeFileSync(join(OUT, 'media-ca.pem'), m[1] + '\n')
    env.NODE_EXTRA_CA_CERTS = join(OUT, 'media-ca.pem')
}
if (process.env.RR_NODE_SNAP === '1' && label.startsWith('node')) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --heapsnapshot-signal=SIGUSR2`
const client = spawn(exe, exeArgs, { cwd: process.env.RR_APPDIR ?? OUT, env, stdio: ['ignore', 'pipe', 'pipe'] })
let buf = ''
const onOut = (d: Buffer) => { const s = d.toString(); log.write(s); buf += s
    let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        const q = l.indexOf('[qr] ')
        if (q >= 0 && !l.includes('ttlMs=') && l.split(',').length >= 5) resolveQr(l.slice(q + 5)) } }
client.stdout.on('data', onOut); client.stderr.on('data', onOut)
let exited: any = null
const times: any = { spawn: Date.now() - t0 }
client.on('exit', (c, s) => { exited = { code: c, signal: s } })


// LAB (RR_SCENARIO=idle|history): the app is held idle with the connection up, or driven through a history sync, while its RSS is sampled every second from /proc.
const SCEN = process.env.RR_SCENARIO ?? ''
const timeline: { t: number; rss: number; hwm: number }[] = []
const marks: { t: number; what: string }[] = []
const procStatus = (pid: number): { rss: number; hwm: number } | null => {
    try { const t = readFileSync(`/proc/${pid}/status`, 'utf8'); const g = (k: string) => Number((t.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) ?? [])[1] ?? 0)
        return { rss: g('VmRSS'), hwm: g('VmHWM') } } catch { return null }
}
// the app is the descendant of the spawned wrapper (pmon, smapspeak) with the most resident memory; with no wrapper it is the child itself
const appPid = (root: number): number => {
    const ppid = new Map<number, number>()
    for (const d of readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue
        try { const st = readFileSync(`/proc/${d}/stat`, 'utf8'); ppid.set(Number(d), Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1])) } catch {} }
    const kin = new Set<number>([root]); let grew = true
    while (grew) { grew = false; for (const [p, pp] of ppid) if (!kin.has(p) && kin.has(pp)) { kin.add(p); grew = true } }
    let best = root, bestRss = -1
    for (const p of kin) { const s = procStatus(p); if (s && s.rss > bestRss) { best = p; bestRss = s.rss } }
    return best
}
let sampler: ReturnType<typeof setInterval> | null = null
const startSampler = () => { if (sampler !== null) return
    sampler = setInterval(() => { if (client.pid === undefined) return; const s = procStatus(appPid(client.pid)); if (s) timeline.push({ t: Date.now() - t0, rss: s.rss, hwm: s.hwm }) }, 1000) }
const mark = (what: string) => { marks.push({ t: Date.now() - t0, what }); log.write(`[lab] ${what}\n`) }
// LAB (RR_HS_SNAP=1): a per-class /proc/<pid>/smaps breakdown of the app at a scenario point, written into the timeline marks (heap(brk), anon-mmap = arena chunks, file-backed code and rodata).
const smapsClasses = (pid: number): Record<string, number> | null => {
    try {
        const exe = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0]
        const out: Record<string, number> = {}
        let cls = ''
        for (const line of readFileSync(`/proc/${pid}/smaps`, 'utf8').split('\n')) {
            const m = line.match(/^[0-9a-f]+-[0-9a-f]+ (\S+) \S+ \S+ \S+\s*(.*)$/)
            if (m) { const perms = m[1], path = m[2]
                cls = path === '[heap]' ? 'heap(brk)' : path === '[stack]' ? 'stack' : path === '' ? 'anon-mmap' : path === exe ? (perms.includes('x') ? 'exe:code' : perms.includes('w') ? 'exe:rw' : 'exe:ro') : path.startsWith('[') ? 'vdso' : 'libs'
                continue }
            const r = line.match(/^Rss:\s+(\d+) kB/)
            if (r) out[cls] = (out[cls] ?? 0) + Number(r[1])
        }
        return out
    } catch { return null }
}
const snapMark = (what: string) => { if (process.env.RR_HS_SNAP !== '1' || client.pid === undefined) return; const pid = appPid(client.pid); const c = smapsClasses(pid); const st = procStatus(pid)
    marks.push({ t: Date.now() - t0, what: `smaps ${what} rss=${st?.rss ?? 0} ${JSON.stringify(c)}` }) }
const results: any[] = []
async function req(method: string, path: string, body?: any) {
    const o: any = { method, headers: {}, signal: AbortSignal.timeout(Number(process.env.RR_REQ_TIMEOUT_MS ?? 120000)) }
    if (body !== undefined) { o.body = typeof body === 'string' ? body : JSON.stringify(body); o.headers['content-type'] = 'application/json' }
    const rec: any = { method, path, body }
    try {
        const r = await fetch(`http://127.0.0.1:${PORT}${path}`, o)
        rec.status = r.status
        rec.headers = Object.fromEntries([...r.headers.entries()].sort())
        rec.body_resp = await r.text()
    } catch (e) { rec.error = String(e) }
    results.push(rec); return rec
}
try {
    const pipeline = await Promise.race([loginP, sleep(60000).then(() => { throw new Error('no login in 60s') })])
    times.login = Date.now() - t0
    const self = await server.createFakePeer({ jid: `${SELF}@s.whatsapp.net` }, pipeline)
    const keys = Array.from({ length: 3 }, (_, i) => ({ keyId: new Uint8Array(16).fill(i + 1), keyData: new Uint8Array(32).fill(i + 9),
        fingerprint: { rawId: 0, currentIndex: 0, deviceIndexes: [] as number[] }, timestamp: 1700000000000 }))
    for (const k of keys) server.registerAppStateSyncKey(k.keyId, k.keyData)
    await self.sendMessage(buildAppStateSyncKeyShareMessage({ keys } as any))
    times.keyShareSent = Date.now() - t0
    await sleep(3000)
    if (SCEN === 'sweep') {
        const { runSweep } = await import('./sweep.mts')
        await runSweep({ server, self, pipeline, req, results, sleep, SELF, mark, outDir: OUT })
        await req('POST', '/s/drive/shutdown')
    } else if (SCEN === 'idle' || SCEN === 'history') {
        startSampler()
        mark('login-settled')
        snapMark('login-settled')
        if (SCEN === 'history') {
            // realistic history: RR_HS_CHATS chats of RR_HS_MSGS messages, sent as RR_HS_CHUNKS external blobs (the shape a real bootstrap takes: one notification per chunk, the blob downloaded and decrypted by the app)
            const chats = Number(process.env.RR_HS_CHATS ?? 400), per = Number(process.env.RR_HS_MSGS ?? 25), chunks = Number(process.env.RR_HS_CHUNKS ?? 8)
            const perChunk = Math.ceil(chats / chunks)
            const body = (c: number, i: number, m: number) => `message ${m} of chat ${c}.${i}: ${'lorem ipsum dolor sit amet '.repeat(1 + ((c + i + m) % 4))}`
            mark(`history-begin chats=${chats} msgs=${per} chunks=${chunks}`)
            for (let c = 0; c < chunks; c++) {
                const conversations = Array.from({ length: Math.min(perChunk, chats - c * perChunk) }, (_, i) => ({
                    id: `55119${String(100000 + c * perChunk + i).padStart(6, '0')}@s.whatsapp.net`, name: `Contact ${c}-${i}`, unreadCount: i % 3,
                    messages: Array.from({ length: per }, (_, m) => ({ id: `3B${String(c).padStart(2, '0')}${String(i).padStart(4, '0')}${String(m).padStart(4, '0')}`.padEnd(20, 'F'), fromMe: m % 2 === 0,
                        timestamp: 1700000000 + c * 100000 + i * 100 + m, message: { conversation: body(c, i, m) } })) }))
                const progress = Math.round(((c + 1) / chunks) * 100)
                if ((process.env.RR_HS_MODE ?? 'inline') === 'external') {
                    // the blob download needs the app to trust the fake server's media TLS certificate, which the REST app does not (self-signed certificate): kept for apps that do
                    const plaintext = await encodeHistorySyncPlaintext({ chunkOrder: c, progress, conversations: conversations as any })
                    const blob = await server.publishMediaBlob({ mediaType: 'history', plaintext })
                    await self.sendHistorySyncExternal({ chunkOrder: c, progress, directPath: server.mediaUrl(blob.path).replace('//127.0.0.1:', '//fake-media.local:'), mediaKey: blob.mediaKey,
                        fileSha256: blob.fileSha256, fileEncSha256: blob.fileEncSha256, fileLength: blob.fileLength })
                    mark(`chunk ${c} sent external plaintext=${plaintext.length}`)
                } else {
                    await self.sendHistorySync({ chunkOrder: c, progress, conversations: conversations as any })
                    mark(`chunk ${c} sent inline chats=${conversations.length}`)
                }
                await sleep(Number(process.env.RR_HS_GAP_MS ?? 1000))
                snapMark(`after-chunk-${c}`)
            }
            // settled: the stored message count has not moved for 10 s (polled every 2 s), at most 10 minutes
            let last = -1, still = 0
            for (let i = 0; i < 300 && still < 5; i++) {
                await sleep(2000)
                const r = await req('GET', '/store/counts'); results.pop()
                let n = -2; try { const j = JSON.parse(r.body_resp ?? '{}'); n = Number(j.messages ?? j.counts?.messages ?? JSON.stringify(j).length) } catch {}
                if (n === last) still++; else { still = 0; last = n }
            }
            const fin = await req('GET', '/store/counts'); results.pop()
            const ev = await req('GET', '/events?type=history_sync_chunk'); results.pop()
            mark(`history-settled count=${last} storeCounts=${(fin.body_resp ?? '').slice(0, 400)} chunkEvents=${(ev.body_resp ?? '').length}b:${(ev.body_resp ?? '').slice(0, 300)}`)
            snapMark('settled')
            if (process.env.RR_NODE_SNAP === '1' && label.startsWith('node') && client.pid !== undefined) {
                // Node's retained heap shape: SIGUSR2 writes a heap snapshot (NODE_OPTIONS=--heapsnapshot-signal), summarised by constructor to node-heap.json
                const pid = appPid(client.pid); const dir = process.env.RR_APPDIR ?? OUT
                try { process.kill(pid, 'SIGUSR2') } catch {}
                await sleep(25000)
                const fs = await import('node:fs'); const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.heapsnapshot'))
                if (files.length > 0) { const f = join(dir, files[files.length - 1]); const snap = JSON.parse(fs.readFileSync(f, 'utf8'))
                    const nf = snap.snapshot.meta.node_fields as string[]; const nt = snap.snapshot.meta.node_types[0] as string[]; const stride = nf.length
                    const ti = nf.indexOf('type'), ni = nf.indexOf('name'), si = nf.indexOf('self_size')
                    const by = new Map<string, { n: number; b: number }>()
                    for (let i = 0; i < snap.nodes.length; i += stride) { const k = `${nt[snap.nodes[i + ti]]}:${snap.strings[snap.nodes[i + ni]]}`.slice(0, 80); const e = by.get(k) ?? { n: 0, b: 0 }; e.n++; e.b += snap.nodes[i + si]; by.set(k, e) }
                    const top = [...by.entries()].sort((a, b) => b[1].b - a[1].b).slice(0, 60).map(([k, v]) => ({ k, n: v.n, bytes: v.b }))
                    const total = [...by.values()].reduce((a, v) => a + v.b, 0)
                    writeFileSync(join(OUT, 'node-heap.json'), JSON.stringify({ file: files[files.length - 1], nodes: snap.nodes.length / stride, totalSelfBytes: total, top }, null, 1))
                    try { fs.unlinkSync(f) } catch {} }
            }
            await sleep(Number(process.env.RR_HS_STEADY_S ?? 60) * 1000)
            snapMark('steady-end')
            mark('steady-end')
        } else {
            const idleS = Number(process.env.RR_IDLE_SECONDS ?? 300)
            mark(`idle-begin ${idleS}s`)
            await sleep(idleS * 1000)
            mark('idle-end')
        }
        await req('GET', '/health')
        await req('POST', '/s/drive/shutdown')
    } else {
    for (let c = 1; c <= 2; c++) {
        await self.sendHistorySync({ chunkOrder: c, progress: c * 50, conversations: Array.from({ length: 3 }, (_, i) => ({
            id: `55119${100000 + c * 1000 + i}@s.whatsapp.net`, name: `Contact ${c}-${i}`, unreadCount: i,
            messages: Array.from({ length: 3 }, (_, m) => ({ id: `3A${c}${i}${m}`.padEnd(20, 'F'), fromMe: m % 2 === 0,
                timestamp: 1700000000 + c * 1000 + i * 10 + m, message: { conversation: `hello c${c} i${i} m${m}` } })) })) as any })
        await sleep(500)
    }
    await sleep(4000)
    await self.sendConversation('live message one')
    await self.sendConversation('live message two')
    await sleep(3000)
    const GETS = ['/health', '/sessions', '/sessions/rows', '/sessions/connection', '/s/drive/state', '/store/threads', '/store/tables', '/store/counts',
        '/store/contacts', '/events', '/messages', '/credentials', '/clockSkewMs', '/auth/getState',
        '/store/thread?jid=55119101000@s.whatsapp.net', '/store/messages?thread=55119101000@s.whatsapp.net', '/store/messages?thread=55119101000@s.whatsapp.net&limit=2', '/store/message?id=3A100FFFFFFFFFFFFFFF', '/store/contact?jid=5511920387975@s.whatsapp.net', '/store/threads?limit=2', '/sessions/rows?id=drive',
        '/events?type=history_sync_chunk', '/events?since=3', '/nonexistent', '/s/bad%20id/state', '/s/nosuch/state', '/qr',
        '/chat/sync']
    if (process.env.RR_SIGUSR1) { client.kill('SIGUSR1'); await sleep(500) } // layout profile: start the steady-state epoch where the HTTP requests begin
    times.firstGet = Date.now() - t0
    for (const g of GETS) await req('GET', g)
    await req('POST', '/message/sendText', { to: `${SELF}@s.whatsapp.net`, text: 'rest hello' })
    await req('POST', '/message/sendText', { to: '5511933334444@s.whatsapp.net', text: 'to another' })
    await req('POST', '/message/sendText', {})
    await req('POST', '/message/react', { to: `${SELF}@s.whatsapp.net`, targetRemoteJid: '55119101000@s.whatsapp.net', targetId: '3A100'.padEnd(20,'F'), emoji: 'x' })
    await req('POST', '/to?to=x&emoji=%F0%9F%91%8D')
    await req('POST', '/message/react', { to: `${SELF}@s.whatsapp.net`, targetRemoteJid: '55119101000@s.whatsapp.net', targetId: '3A100'.padEnd(20,'F'), emoji: '\u{1F44D}' })
    await req('POST', '/chat/setChatPin', { chatJid: '55119101000@s.whatsapp.net', pinned: true })
    await req('POST', '/presence/send', { type: 'available' })
    await req('POST', '/sessions/create?id=second')
    await req('GET', '/sessions')
    await req('POST', '/sessions/remove?id=second')
    await req('POST', '/x', 'not json at all')
    await sleep(2000)
    for (const g of ['/store/messages?thread=55119101000@s.whatsapp.net', '/store/threads', '/store/counts', '/events']) await req('GET', g)
    await req('POST', '/s/drive/shutdown')
    }
} catch (e) { results.push({ driverError: String(e) }) }
for (let i = 0; i < 40 && exited === null; i++) await sleep(250)
if (exited === null) { results.push({ note: 'app did not exit after shutdown; killing by pid', pid: client.pid }); client.kill('SIGTERM'); await sleep(1000) }
writeFileSync(join(OUT, 'http.json'), JSON.stringify(results, null, 1))
writeFileSync(join(OUT, 'stanzas.json'), JSON.stringify(stanzas, null, 1))
times.end = Date.now() - t0
writeFileSync(join(OUT, 'times.json'), JSON.stringify(times))
if (SCEN === 'idle' || SCEN === 'history') { if (sampler) clearInterval(sampler); writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ scenario: SCEN, marks, timeline })) }
writeFileSync(join(OUT, 'exit.json'), JSON.stringify({ exited, ms: Date.now() - t0 }))
await server.stop(); log.end()
console.log(label, 'done', JSON.stringify(exited), results.length, 'requests', stanzas.length, 'stanzas')
process.exit(0)
