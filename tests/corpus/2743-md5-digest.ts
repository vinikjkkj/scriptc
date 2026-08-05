// createHash("md5") — the fourth digest, whose core the runtime already had.
//
// The compiler admitted sha256, sha512 and sha1 and fenced every other
// name. The runtime's one-shot bridge for the island crypto shim
// (scr_crypto_digest_raw) has ALWAYS dispatched md5 to a complete
// scr_md5_digest; what was missing was the name in three places that route
// the STATIC forms: the compiler's admitted set, scr_hash_by_name (the
// fused createHash(a).update(d).digest(e) chain) and scr_alg_id (the
// materialized ScrHash/ScrHmac handles). Two of those functions FALL
// THROUGH to sha256 for a name they do not recognize, which is why they
// and the compiler's set have to name the same algorithms — a hash lowered
// to the wrong function is silently wrong, and this file is where that
// would show.
//
// md5 is a legacy DIGEST, not a security primitive. It is here because
// wire formats still specify it: zapo's Noise client payload derives its
// build hash with md5, on the path that produces a login QR.
//
// What this pins against Node: md5 through both lowering paths (the fused
// chain and the handle bound to a variable and updated in a loop), both
// output encodings and the bare Buffer digest, string and byte inputs, the
// empty input and inputs spanning the 64-byte block and length-padding
// boundaries, HMAC-MD5 with keys shorter than, equal to and longer than
// the 64-byte block (the RFC 2104 key-replacement branch), and every other
// admitted algorithm alongside so a regression in the three that already
// worked lands in the same run.
//
// WHAT KEEPS ITS FENCE, verified by watching the build refuse it rather
// than written here as a compiled assertion: a NON-LITERAL algorithm
// (`createHash(algFromArray)`). The name decides which core runs, so it
// has to be known at compile time; that is unchanged by adding md5.

import { createHash, createHmac } from 'node:crypto'

function literals(input: string): void {
    console.log(`fused-md5 ${createHash('md5').update(input).digest('hex')}`)
    console.log(`fused-sha1 ${createHash('sha1').update(input).digest('hex')}`)
    console.log(`fused-sha256 ${createHash('sha256').update(input).digest('hex')}`)
    console.log(`fused-sha512 ${createHash('sha512').update(input).digest('hex')}`)
    console.log(`fused-md5-b64 ${createHash('md5').update(input).digest('base64')}`)
}

// The handle path: bound to a variable, updated more than once, digested
// after the loop. Nothing here can fuse.
function handle(chunks: readonly string[]): string {
    const h = createHash('md5')
    for (let i = 0; i < chunks.length; i += 1) {
        h.update(chunks[i])
    }
    return h.digest('hex')
}

function handleBytes(chunks: readonly Uint8Array[]): string {
    const h = createHash('md5')
    for (let i = 0; i < chunks.length; i += 1) {
        h.update(chunks[i])
    }
    return h.digest('hex')
}

// The bare digest: Node hands back the raw 16 bytes.
function raw(input: string): string {
    const d = createHash('md5').update(input).digest()
    let s = ''
    for (let i = 0; i < d.length; i += 1) {
        s += `${d[i]},`
    }
    return `${d.length}:${s}`
}

const BLOCK_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function macs(input: string): void {
    console.log(`hmac-md5-short ${createHmac('md5', 'k').update(input).digest('hex')}`)
    console.log(`hmac-md5-block ${createHmac('md5', BLOCK_KEY).update(input).digest('hex')}`)
    // Longer than the 64-byte block: RFC 2104 replaces the key by its digest.
    console.log(`hmac-md5-long ${createHmac('md5', `${BLOCK_KEY}EXTRA`).update(input).digest('hex')}`)
    console.log(`hmac-md5-empty-key ${createHmac('md5', '').update(input).digest('hex')}`)
    console.log(`hmac-sha256-short ${createHmac('sha256', 'k').update(input).digest('hex')}`)
}

function bytesOf(n: number, seed: number): Uint8Array {
    const b = new Uint8Array(n)
    for (let i = 0; i < n; i += 1) {
        b[i] = (i * 31 + seed) % 256
    }
    return b
}

function pads(): void {
    // 55, 56, 64 and 120 bytes: the padding corners of a 64-byte block
    // digest (55 fits alongside the length, 56 forces a second block, 64
    // is the exact block, 120 spans two).
    const sizes = [55, 56, 64, 120]
    for (let i = 0; i < sizes.length; i += 1) {
        let s = ''
        for (let j = 0; j < sizes[i]; j += 1) s += 'x'
        console.log(`pad${sizes[i]} ${createHash('md5').update(s).digest('hex')}`)
    }
}

function main(): void {
    literals('abc')
    literals('')
    pads()
    console.log(`handle ${handle(['ab', 'c', '', 'defg'])}`)
    console.log(`handle-empty ${handle([])}`)
    console.log(`handle-bytes ${handleBytes([bytesOf(10, 1), bytesOf(70, 2)])}`)
    console.log(`raw ${raw('abc')}`)
    macs('the message')
}

main()
