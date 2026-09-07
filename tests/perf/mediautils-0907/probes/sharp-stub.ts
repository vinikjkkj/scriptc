// EXPERIMENT ARM for the sharp cluster. `sharp@0.33.5` publishes no provenance
// attestation, so --provenance-sources islands it and every value that comes
// out of it is dyn-typed. This stub has the SAME SHAPE and STATIC TYPES that
// media-utils/sharp.ts uses, and nothing else changes. If the 5 sharp.ts sites
// go to 0, all five are downstream of the one island -- which no roots/cascade
// split can show, because only 2 of the 5 carry the SC2004 cascade code.
import { Writable } from 'node:stream'

export interface SharpToBufferResult {
    readonly data: Uint8Array
    readonly info: { readonly width: number; readonly height: number }
}

export class Sharp extends Writable {
    rotate(): Sharp { return this }
    resize(_w: number, _h: number, _o: { fit: string; withoutEnlargement: boolean }): Sharp { return this }
    jpeg(_o: { quality: number }): Sharp { return this }
    png(): Sharp { return this }
    async toBuffer(_o: { resolveWithObject: true }): Promise<SharpToBufferResult> {
        return { data: new Uint8Array(0), info: { width: 0, height: 0 } }
    }
}

export default function sharp(_input?: Uint8Array | string): Sharp {
    return new Sharp()
}
