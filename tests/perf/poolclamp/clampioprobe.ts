// The IO arm: a fetch IN FLIGHT while the decay windows fire.
//
// WHY IT IS NEEDED. clampnetprobe.ts covers the non-io socket path, where
//   if ((net || dgram || watch) && due > now + SCR_CHILD_POLL_MS) ...
// caps at 1.0 ms -- the same value wake_floor uses, so the floor covers it.
//
// This probe drives the OTHER arm, which no probe reached before:
//   if (io) {
//     if (kids && ...) due = now + SCR_CHILD_POLL_MS;                 //  1 ms
//     else if ((evw || net || dgram || watch) && ...)
//       due = now + SCR_SIGNAL_POLL_MS;                               // 50 ms
//   }
// A fetch in flight makes `io` true; the listening server makes `net` true;
// there are no children. So the arm intends a 50 ms sleep while wake_floor
// only guarantees 1 ms -- the decay can still shorten the poll 50x, and the
// old subcap counter (testing against 1 ms) could not see it.
//
// Run with SCR_FIBER_POOL_DECAY_MS small so windows fire inside the keepalive.

import * as http from "node:http"

const CONC = 2000
const PER = 200
const KEEPALIVE_MS = 1000
const TICKS = 8
const ORIGIN_DELAY_MS = 900
const PORT = 8818

function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => { setTimeout(() => resolve(), ms) })
}
async function leaf(i: number): Promise<number> { await sleep(40); return i }
async function mid(i: number, keep: string[]): Promise<number> {
    const v = await leaf(i)
    return v + keep.length
}
async function one(i: number): Promise<number> {
    const keep = new Array<string>(PER)
    for (let j = 0; j < PER; j += 1) keep[j] = `55119999${j}:1@s.whatsapp.net`
    const a = await mid(i, keep)
    const b = await mid(i, keep)
    return a + b
}

async function main(): Promise<void> {
    // A deliberately SLOW origin: the response is held so the fetch stays in
    // flight across several decay windows instead of completing between them.
    const srv = http.createServer((req, res) => {
        setTimeout(() => { res.end("ok") }, ORIGIN_DELAY_MS)
    })
    srv.listen(PORT)

    console.log('[phase-begin] burst')
    const promises = new Array<Promise<number>>(CONC)
    for (let i = 0; i < CONC; i += 1) promises[i] = one(i)
    const all = await Promise.all(promises)
    let sum = 0
    for (let i = 0; i < all.length; i += 1) sum += all[i]
    console.log(`[phase-end] burst sum=${sum}`)

    // THE ARM UNDER TEST: io pending (fetch) AND net pending (listener),
    // no children -- so the loop takes the 50 ms cap while the decay floors
    // its wake at 1 ms.
    console.log('[phase-begin] keepalive-with-fetch')
    for (let t = 0; t < TICKS; t += 1) {
        const inflight = fetch(`http://127.0.0.1:${PORT}/`)
        await sleep(KEEPALIVE_MS)
        const r = await inflight
        const body = await r.text()
        console.log(`[keepalive] tick ${t + 1} body=${body}`)
    }
    console.log('[phase-end] keepalive-with-fetch')
    srv.close()
}
void main()
