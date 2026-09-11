// Probe for the fiber-pool decay's POLL CLAMP, and it is shaped after the
// failing case rather than after an idle process.
//
// WHY A KEEPALIVE AND NOT A BARE IDLE. The clamp only fires when the loop's
// natural deadline EXCEEDS the decay window:
//
//   due = scr_ntimers > 0 ? scr_timers[0].deadline_ms : now + SCR_IO_POLL_MS
//
// The 1000 ms SCR_IO_POLL_MS floor applies ONLY with zero timers pending. A
// process holding any timer further out than the window has no such floor --
// it sleeps to that timer. So a bare idle probe would never exercise the
// clamp at all and would report a clean zero that means nothing.
//
// The reported pairing fault ran a 10 s keepalive, so that is what this holds:
// a repeating 10 s tick, against a 5 s decay window. Expected, with the clamp
// ON, a wakeup at 5 s AND at 10 s; with it OFF, only the 10 s one. The decay
// still runs on every wakeup it does get -- it is called before and
// independent of the `due` computation -- so the pool should still drain,
// just half as often.
//
// The burst first fills the pool to its cap so there is something to decay;
// without that scr_stack_pool_decay_due returns -1 and imposes no wakeups.

const CONC = 3000
const PER = 500
const KEEPALIVE_MS = 10000
const TICKS = 6

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
    console.log('[phase-begin] burst')
    const promises = new Array<Promise<number>>(CONC)
    for (let i = 0; i < CONC; i += 1) promises[i] = one(i)
    const all = await Promise.all(promises)
    let sum = 0
    for (let i = 0; i < all.length; i += 1) sum += all[i]
    console.log(`[phase-end] burst sum=${sum}`)

    // The keepalive phase: the only pending work is one timer per tick, so
    // the loop's natural deadline is KEEPALIVE_MS and the clamp -- if armed
    // -- inserts an extra wakeup at the decay window inside every one.
    console.log('[phase-begin] keepalive')
    for (let t = 0; t < TICKS; t += 1) {
        await sleep(KEEPALIVE_MS)
        console.log(`[keepalive] tick ${t + 1}`)
    }
    console.log('[phase-end] keepalive')
}

void main()
