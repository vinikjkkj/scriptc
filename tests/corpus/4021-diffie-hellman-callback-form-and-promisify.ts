// `crypto.diffieHellman(options, callback)` -- Node's CALLBACK form -- and
// `util.promisify` over it.
//
// Both refusals read, on main:
//
//     calling a function value with 2 arguments where its lowered
//     signature takes 1                                          SC1090
//     'util.promisify' is typed by @types/node but has no scriptc
//     lowering yet                                               SC2020
//
// and they are ONE job rather than two. The X25519 module that provokes them
// writes a runtime probe:
//
//     const result = (diffieHellman as unknown as (o, cb) => Buffer | undefined)(
//         { privateKey, publicKey }, () => {})
//     if (result === undefined) {
//         diffieHellmanAsync = promisify(diffieHellmanWithCallback)
//     }
//
// The tempting fix for the first refusal -- JS ignores extra arguments, so
// drop the callback -- is a SILENT DIVERGENCE, and it was measured before any
// code was written: Node v25.9.0 really does have the two-argument form, it
// really does answer `undefined`, and dropping the argument would call the
// one-argument agreement and answer a 32-byte Buffer instead. The probe would
// then take the other branch and the module would stay on the synchronous
// path Node leaves. That is why the callback form gets a LOWERING here and
// not an arity fence, and it is why r04/r05 exist: closing the first refusal
// alone walks the program straight into the second one.
//
// THE SPELLING, and why every row here casts. The two-argument call is
// written as `(diffieHellman as unknown as (o, cb) => R)(opts, cb)` -- zapo's
// own spelling, and the only one the fallback node declarations can express.
// The DIRECT spelling `diffieHellman(opts, cb)` lowers identically (@types/node
// declares that overload and it was run byte-identically to Node in a
// directory with real @types/node installed), but declaring the second
// overload in scriptc-node-fallback.d.ts makes `const dh = diffieHellman` a
// value of an OVERLOADED type, which SC2007 refuses -- and that binding is
// what 2717-diffie-hellman-as-a-value.ts pins. Adding the overload turned
// 2717 red on both backends; the price is recorded in the .d.ts beside the
// declaration that was not added.
//
// THE DIVERGENCE THIS LOWERING KEEPS, stated so no row hides it. Node runs
// the agreement on libuv's threadpool and calls back in a later loop turn. A
// compiled binary has no threadpool: the agreement runs synchronously and the
// callback is delivered on the MICROTASK queue -- the already-settled stance
// util.promisify's other callback builtins take. So the VALUE is Node's and
// the callback is still asynchronous (r03 pins that), but its position
// relative to timers and I/O is not Node's, and no row here claims it is.
//
// r01-r05 and r07 are the rows that fail to build on main. r06 and r08 are
// controls: the one-argument agreement that already lowered, and a
// promisified binding that is only ever bound.

import { diffieHellman, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { promisify } from 'node:util'

type Opts = { privateKey: KeyObject; publicKey: KeyObject }
type DiffieHellmanCallback = (err: Error | null, secret: Buffer) => void

// The CAST ALIAS: bound once at module scope and promisified later. This is
// the binding the promisify target has to be resolved through -- a one-hop
// const alias of the import, not the import itself.
const diffieHellmanWithCallback = diffieHellman as unknown as (
    options: Opts,
    callback: DiffieHellmanCallback
) => void

type DiffieHellmanAsync = (options: Opts) => Promise<Buffer>

// The DECLARATION form of the same promisify, for contrast with the
// assignment in r04.
const dhFromDeclaration: DiffieHellmanAsync = promisify(diffieHellmanWithCallback)

let dhFromAssignment: DiffieHellmanAsync | null = null
let probed = false

function resolveDiffieHellmanAsync(): DiffieHellmanAsync | null {
    if (probed) return dhFromAssignment
    probed = true
    try {
        const probe = generateKeyPairSync('x25519')
        const result = (
            diffieHellman as unknown as (opts: Opts, cb: DiffieHellmanCallback) => Buffer | undefined
        )({ privateKey: probe.privateKey, publicKey: probe.publicKey }, () => {})
        if (result === undefined) {
            dhFromAssignment = promisify(diffieHellmanWithCallback)
        }
    } catch {
        // callback form not supported by this runtime; stay on sync path
    }
    return dhFromAssignment
}

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

    const sync = diffieHellman(ab)

    // r01 -- the probe itself: the two-argument form answers undefined. This
    // is the whole reason the extra argument may not be dropped.
    const probe = generateKeyPairSync('x25519')
    const result = (
        diffieHellman as unknown as (opts: Opts, cb: DiffieHellmanCallback) => Buffer | undefined
    )({ privateKey: probe.privateKey, publicKey: probe.publicKey }, () => {})
    console.log('r01 ' + (result === undefined ? 'undefined' : 'buffer'))

    // r02 -- a real (err, secret) callback: err is null and the secret is the
    // same 32 bytes the one-argument form computes. The callback's declared
    // parameter type is `Error | null`, which has no dyn representation, so
    // this row is also what forces the notify thunk to be typed rather than
    // boxed through the checked-dynamic boundary.
    let seenErr = 'not-called'
    let seenHex = ''
    ;(diffieHellman as unknown as (opts: Opts, cb: DiffieHellmanCallback) => void)(ab, (err, secret) => {
        seenErr = err === null ? 'null' : 'error'
        seenHex = hex(secret)
    })
    await new Promise<void>((r) => setTimeout(r, 60))
    console.log('r02 ' + seenErr + ' ' + String(seenHex === hex(sync)) + ' ' + String(seenHex.length))

    // r03 -- the callback is NOT synchronous. Both runtimes defer it past the
    // tail of the calling turn; only the exact queue differs, so this row
    // asks the question both can answer the same way.
    const order: string[] = []
    ;(diffieHellman as unknown as (opts: Opts, cb: () => void) => void)(ab, () => {
        order.push('cb')
    })
    order.push('sync-tail')
    await new Promise<void>((r) => setTimeout(r, 60))
    console.log('r03 ' + order.join(','))

    // r04 -- the ASSIGNMENT spelling: the probe takes Node's branch, so the
    // nullable binding ends up holding a function, and awaiting it agrees
    // with the synchronous secret.
    const dhAsync = resolveDiffieHellmanAsync()
    console.log('r04 ' + String(dhAsync !== null))
    if (dhAsync) {
        const secret = await dhAsync(ab)
        console.log('r04b ' + String(hex(secret) === hex(sync)) + ' ' + String(secret.length))
    }

    // r05 -- the DECLARATION spelling of the same promisify, awaited twice
    // (the lifted closure is one interned function; calling it again must
    // recompute rather than replay).
    const s1 = await dhFromDeclaration(ab)
    const s2 = await dhFromDeclaration(ba)
    console.log('r05 ' + String(hex(s1) === hex(s2)) + ' ' + String(s1.length))

    // r06 -- CONTROL: the one-argument agreement, which already lowered.
    console.log('r06 ' + String(hex(diffieHellman(ba)) === hex(sync)))

    // r07 -- the callback form and the promisified form and the synchronous
    // form all agree, over a BOUND options record rather than a literal at
    // the call (the spelling a caller writes when the same options feed both
    // paths -- the X25519 module's own).
    let viaCallback = ''
    ;(diffieHellman as unknown as (opts: Opts, cb: DiffieHellmanCallback) => void)(ba, (_err, secret) => {
        viaCallback = hex(secret)
    })
    await new Promise<void>((r) => setTimeout(r, 60))
    const viaPromise = hex(await dhFromDeclaration(ba))
    console.log('r07 ' + String(viaCallback === hex(sync)) + ' ' + String(viaPromise === hex(sync)))

    // r08 -- CONTROL: a promisified binding that is only ever BOUND. Node's
    // bind succeeds without calling anything, and so must this one.
    const neverCalled: DiffieHellmanAsync = promisify(diffieHellmanWithCallback)
    console.log('r08 ' + String(typeof neverCalled))
}

void main()
