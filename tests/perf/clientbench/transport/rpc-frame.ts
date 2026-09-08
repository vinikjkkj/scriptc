/**
 * Length-prefixed framing for the bench's control channel.
 *
 * This replaces Node's `fork()` IPC, which a compiled binary cannot open:
 * the channel needs a libuv-compatible pipe plus the NODE_CHANNEL_FD
 * handshake, and `serialization: 'advanced'` is V8's versioned
 * ValueSerializer format. The parent listens on a socket instead and the
 * child connects back; this module is the wire format for both ends.
 *
 * Binary rides as RAW BYTES in the frame, never base64 and never a
 * `number[]`. That property is load-bearing: this is a memory-and-CPU
 * bench, and a transport that inflates a multi-MB media payload would
 * corrupt the thing being measured. Attachments are EXPLICIT rather than
 * discovered by walking the message — the parent half of this channel is
 * compiled statically, where a reflective deep-walk over `unknown` has no
 * cheap lowering, and an explicit list also makes every binary crossing
 * visible at its call site.
 *
 * Frame layout (all integers big-endian, matching Buffer's *UInt32BE):
 *
 *   u32  bodyLen      bytes following this field
 *   u32  blobCount    N
 *   u32  jsonLen      byte length of the UTF-8 JSON
 *   u32  blobLen[N]   byte length of each attachment, in order
 *   ...  json         UTF-8
 *   ...  blob[N]      raw bytes, concatenated
 */

export const FRAME_HEADER_BYTES = 4

/** One decoded frame: the JSON text and its attachments, in order. */
export interface Frame {
    readonly json: string
    readonly blobs: readonly Uint8Array[]
}

export function encodeFrame(json: string, blobs: readonly Uint8Array[]): Buffer {
    const jsonBuf = Buffer.from(json, 'utf8')
    let blobBytes = 0
    for (const b of blobs) blobBytes += b.length
    const bodyLen = 4 + 4 + 4 * blobs.length + jsonBuf.length + blobBytes
    const out = Buffer.alloc(4 + bodyLen)
    let off = 0
    out.writeUInt32BE(bodyLen, off)
    off += 4
    out.writeUInt32BE(blobs.length, off)
    off += 4
    out.writeUInt32BE(jsonBuf.length, off)
    off += 4
    for (const b of blobs) {
        out.writeUInt32BE(b.length, off)
        off += 4
    }
    jsonBuf.copy(out, off)
    off += jsonBuf.length
    for (const b of blobs) {
        Buffer.from(b.buffer, b.byteOffset, b.length).copy(out, off)
        off += b.length
    }
    return out
}

/**
 * Reassembles frames from a byte stream. A socket delivers arbitrary
 * chunk boundaries -- the single most common way a hand-rolled framing
 * goes wrong is assuming one chunk is one message, so this buffers until
 * a whole frame is present and can return several from one chunk.
 */
export class FrameReader {
    private buf: Buffer = Buffer.alloc(0)

    public push(chunk: Buffer): Frame[] {
        this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
        const out: Frame[] = []
        for (;;) {
            if (this.buf.length < 4) break
            const bodyLen = this.buf.readUInt32BE(0)
            if (this.buf.length < 4 + bodyLen) break
            const body = this.buf.subarray(4, 4 + bodyLen)
            this.buf = this.buf.subarray(4 + bodyLen)
            let off = 0
            const blobCount = body.readUInt32BE(off)
            off += 4
            const jsonLen = body.readUInt32BE(off)
            off += 4
            const lens: number[] = []
            for (let i = 0; i < blobCount; i++) {
                lens.push(body.readUInt32BE(off))
                off += 4
            }
            const json = body.subarray(off, off + jsonLen).toString('utf8')
            off += jsonLen
            const blobs: Uint8Array[] = []
            for (const len of lens) {
                // A COPY, not a view: the reader's buffer is reused and
                // sliced as more chunks arrive, and a view into it would
                // change under the holder.
                blobs.push(Uint8Array.from(body.subarray(off, off + len)))
                off += len
            }
            out.push({ json, blobs })
        }
        return out
    }
}
