// The NEGATIVE arm for clampSurvived: identical to clampprobe.ts except that a
// socket is open the whole time.
//
// WHY IT IS NEEDED. clampSurvived must be shown to read ZERO when the socket
// cap overrides the clamp, not only to read non-zero when it does not.
// Otherwise we have traded a counter that cannot discriminate for one that has
// never been seen to.
//
// With a listening server the loop takes the events/net branch, where
//   if ((net || dgram || watch) && due > now + SCR_CHILD_POLL_MS)
//     due = now + SCR_CHILD_POLL_MS;            // 1.0 ms
// runs AFTER the pool clamp and lowers `due` below it every time. So the clamp
// still FIRES (clampApplied climbs) and never DECIDES (clampSurvived stays 0),
// which is exactly the state the user's real run will be in.

import * as http from "node:http"

const CONC = 3000
const PER = 500
const KEEPALIVE_MS = 10000
const TICKS = 4

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
    const srv = http.createServer(() => {})
    srv.listen(8817)
    console.log('[phase-begin] burst')
    const promises = new Array<Promise<number>>(CONC)
    for (let i = 0; i < CONC; i += 1) promises[i] = one(i)
    const all = await Promise.all(promises)
    let sum = 0
    for (let i = 0; i < all.length; i += 1) sum += all[i]
    console.log(`[phase-end] burst sum=${sum}`)

    console.log('[phase-begin] keepalive')
    for (let t = 0; t < TICKS; t += 1) {
        await sleep(KEEPALIVE_MS)
        console.log(`[keepalive] tick ${t + 1}`)
    }
    console.log('[phase-end] keepalive')
    srv.close()
}
void main()
