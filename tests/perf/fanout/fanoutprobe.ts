// ARMING PROBE for three instruments at once. Not a bench: it exists only to
// prove that each one can tell "found none" from "there are none".
//
//   1. the [phase-begin]/[phase-end] console markers reach scr_memmap.h's
//      fwrite interposer, so a phase snapshot file is written at all;
//   2. scr_fiber_stat.h's gauges move, and move BY A KNOWN AMOUNT: the
//      concurrency below is exactly CONC, so outHi must be at least CONC;
//   3. the phase-begin snapshot and the peak snapshot differ, i.e. the two
//      walks describe different instants rather than the same one twice.
//
// The middle phase deliberately holds CONC async calls suspended at once and
// each of them retains a 500-element array, which is the shape of the real
// bench's send_group in miniature.

const CONC = 3000
const PER = 500

function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
        setTimeout(() => resolve(), ms)
    })
}

async function leaf(i: number): Promise<number> {
    await sleep(40)
    return i
}

async function mid(i: number, keep: string[]): Promise<number> {
    const v = await leaf(i)
    return v + keep.length
}

async function one(i: number): Promise<number> {
    const keep = new Array<string>(PER)
    for (let j = 0; j < PER; j += 1) {
        keep[j] = `55119999${j}:1@s.whatsapp.net`
    }
    const a = await mid(i, keep)
    const b = await mid(i, keep)
    return a + b
}

async function main(): Promise<void> {
    console.log('[phase-begin] warm')
    await sleep(50)
    console.log('[phase-end] warm')

    console.log('[phase-begin] burst')
    const promises = new Array<Promise<number>>(CONC)
    for (let i = 0; i < CONC; i += 1) {
        promises[i] = one(i)
    }
    const all = await Promise.all(promises)
    let sum = 0
    for (let i = 0; i < all.length; i += 1) sum += all[i]
    console.log(`[phase-end] burst`)
    console.log(`sum ${sum}`)

    console.log('[phase-begin] after')
    await sleep(200)
    console.log('[phase-end] after')
}

void main()
