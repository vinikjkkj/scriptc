// util.promisify over crypto.diffieHellman's callback form, the spelling zapo uses for X25519 shared secrets. Node runs the agreement on libuv's
// threadpool and settles the promise in the poll phase: after the synchronous run, the nextTick queue and the promise jobs. Pinned here (none of it
// depends on threadpool timing): that order, the right 32-byte secret for 60 concurrent requests, symmetric agreement, and a key of the wrong kind
// REJECTING the promise instead of throwing out of the call. The secrets themselves are random keys' and never printed.
import { diffieHellman, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { promisify } from 'node:util'

type Opts = { privateKey: KeyObject; publicKey: KeyObject }
type DiffieHellmanCallback = (err: Error | null, secret: Buffer) => void
const withCallback = diffieHellman as unknown as (options: Opts, callback: DiffieHellmanCallback) => void
const dh: (options: Opts) => Promise<Buffer> = promisify(withCallback)

function hex(b: Uint8Array): string {
    let out = ''
    for (let i = 0; i < b.length; i++) {
        const d = b[i]!.toString(16)
        out += d.length === 1 ? '0' + d : d
    }
    return out
}

async function main(): Promise<void> {
    const alice = generateKeyPairSync('x25519')
    const bob = generateKeyPairSync('x25519')
    const ab: Opts = { privateKey: alice.privateKey, publicKey: bob.publicKey }
    const ba: Opts = { privateKey: bob.privateKey, publicKey: alice.publicKey }
    const want = hex(diffieHellman(ab))

    const order: string[] = []
    const p = dh(ab).then((s) => {
        order.push('secret ' + s.length + ' ' + String(hex(s) === want))
    })
    process.nextTick(() => order.push('tick'))
    Promise.resolve().then(() => order.push('micro'))
    order.push('sync')
    await p
    console.log(order.join(' | '))

    const all = await Promise.all(Array.from({ length: 60 }, (_, i) => dh(i % 2 === 0 ? ab : ba)))
    let ok = 0
    for (let i = 0; i < all.length; i++) if (hex(all[i]!) === want) ok++
    console.log('concurrent ok', ok, 'of', all.length)

    // the wrong kind of key: both halves public. The call must not throw; the promise rejects.
    const bad: Opts = { privateKey: bob.publicKey, publicKey: alice.publicKey }
    let threw = false
    let rejected: Promise<Buffer> | null = null
    try {
        rejected = dh(bad)
    } catch {
        threw = true
    }
    console.log('threw out of the call', threw)
    if (rejected !== null) {
        try {
            await rejected
            console.log('no rejection')
        } catch (e) {
            console.log('rejected', e instanceof Error)
        }
    }

    // the pool keeps serving after a rejection, and a result still arrives after later ticks
    const again = await dh(ba)
    console.log('after the rejection', hex(again) === want)
}
main().then(() => console.log('done'))
