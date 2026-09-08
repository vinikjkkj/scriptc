/* decode-answer.ts — THE question, at the smallest scale that can answer it.
 *
 *   Does a COMPILED zapo decode argo correctly?
 *
 * argo-decoder-copy.ts is zapo's src/transport/node/mex/argo-decoder.ts byte
 * for byte (only the `TEXT_DECODER` import is inlined, because @util/bytes is
 * a path alias into the zapo tree). It carries zapo's own `loadArgo()` --
 * `cachedArgo = await import('argo-codec')` stored into a module-level
 * `let cachedArgo: ArgoModule | null | undefined`, which is the spelling that
 * matters: the namespace is STORED, not read at a const binding.
 *
 * The 114 bytes below are argo-codec's OWN encoder's output for the payload
 * the fake server answers `w:mex` with, captured under node from the same
 * node_modules this program compiles. So this is the same cross-implementation
 * exercise the bench performs, with zapo's real decoder, and the answer is
 * VALUES -- not "no throw".
 *
 * Node oracle for exactly this program:
 *   isActive=true enforcementType=SOFT_BLOCK enforcementEndsAt=1767225600
 */
import { decodeMexArgoResponse, isMexArgoDecoderAvailable } from './argo-decoder-copy'

const FIXTURE: number[] = [
    0, 184, 1, 120, 119, 97, 50, 95, 102, 101, 116, 99, 104, 95, 97, 99, 99, 111, 117, 110,
    116, 95, 114, 101, 97, 99, 104, 111, 117, 116, 95, 116, 105, 109, 101, 108, 111, 99, 107,
    105, 115, 95, 97, 99, 116, 105, 118, 101, 101, 110, 102, 111, 114, 99, 101, 109, 101, 110,
    116, 95, 116, 121, 112, 101, 83, 79, 70, 84, 95, 66, 76, 79, 67, 75, 116, 105, 109, 101,
    95, 101, 110, 102, 111, 114, 99, 101, 109, 101, 110, 116, 95, 101, 110, 100, 115, 10, 128,
    228, 173, 149, 13, 24, 4, 2, 72, 4, 6, 18, 2, 32, 8, 20, 42, 12,
]

export async function main(): Promise<void> {
    const bytes = new Uint8Array(FIXTURE.length)
    for (let i = 0; i < FIXTURE.length; i++) bytes[i] = FIXTURE[i]!
    console.log('[decode-answer] bytes=' + String(bytes.length))

    // Step 1: the availability question zapo's client.ts:108 asks. It is the
    // one whose FALSE answer produces the "'argo-codec' not installed"
    // message for a package that is installed and compiled in.
    let avail = false
    try {
        avail = await isMexArgoDecoderAvailable()
        console.log('[decode-answer] isMexArgoDecoderAvailable = ' + String(avail))
    } catch (err) {
        console.log('[decode-answer] availability THREW: ' + (err as Error).message)
    }

    // Step 2: the decode itself, reported as values.
    try {
        const res = await decodeMexArgoResponse(bytes)
        const data = res.data as Record<string, unknown> | null
        const tl = (data === null ? null : data['xwa2_fetch_account_reachout_timelock']) as
            | Record<string, unknown>
            | null
            | undefined
        if (tl === null || tl === undefined) {
            console.log('[decode-answer] DECODED but the timelock field is absent')
            return
        }
        console.log(
            '[decode-answer] OK isActive=' +
                String(tl['is_active']) +
                ' enforcementType=' +
                String(tl['enforcement_type']) +
                ' enforcementEndsAt=' +
                String(tl['time_enforcement_ends']),
        )
    } catch (err) {
        console.log('[decode-answer] DECODE THREW: ' + (err as Error).message)
    }
}
void main()
