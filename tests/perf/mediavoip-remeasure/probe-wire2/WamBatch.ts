import {
    WA_WAM_CHANNEL_WIRE_CODES,
    WA_WAM_PROTOCOL_VERSION
} from '@vinikjkkj/wa-wam'

// The ONE change in this copy: `type WaWamChannel` was in the import list
// above. Under --npm-static the package types by inference over its JS, its
// hand-written index.d.ts stops being consulted, and that one type token
// sends the whole 28,758-line table to the island. The alias below is
// character-for-character what index.d.ts declares.
type WaWamChannel = 'private' | 'realtime' | 'regular'

import { BinaryWriter } from './binary-writer.js'
import { type WamValueKind, writeEventHeader, writeField, writeGlobalAttribute } from './encoder.js'

/** Global attribute id `WAWebWamLibContext` re-stamps before every event. */
const COMMIT_TIME_GLOBAL_ID = 47

export type WamGlobalValue = number | string | boolean | null

/** A single event field resolved to its wire id, encoding kind, and value. */
export interface WamResolvedField {
    readonly id: number
    readonly kind: WamValueKind
    readonly value: number | string | boolean
}

/**
 * One WAM batch for a single channel: the header, a running committed-globals
 * map (unchanged globals are not re-emitted), and the appended events, mirroring
 * `WAWamBuffer` + `WAWebWamLibContext`.
 */
export class WamBatch {
    private readonly writer = new BinaryWriter(512)
    private readonly committedGlobals = new Map<number, WamGlobalValue>()
    private eventsWritten = 0

    constructor(
        readonly channel: WaWamChannel,
        readonly streamId: number,
        readonly sequenceNumber: number,
        initialGlobals: ReadonlyMap<number, WamGlobalValue>
    ) {
        this.writer.writeString('WAM')
        this.writer.writeUint8(WA_WAM_PROTOCOL_VERSION)
        this.writer.writeUint8(streamId & 0xff)
        this.writer.writeUint16(sequenceNumber & 0xffff)
        this.writer.writeUint8(WA_WAM_CHANNEL_WIRE_CODES[channel])
        for (const [id, value] of initialGlobals) {
            writeGlobalAttribute(this.writer, id, value)
            this.committedGlobals.set(id, value)
        }
    }

    /** Delta-writes a global attribute: only emitted when its value changed. */
    setGlobal(id: number, value: WamGlobalValue): void {
        // The SECOND change in this copy, and the only one beyond probe-wire's
        // one type token. `this.committedGlobals.get(id) === value` compares two
        // `number | string | boolean | null` values and refuses with SC1090
        // "comparisons of union-typed values (narrow first ...)". Narrowing per
        // arm, exactly as the diagnostic asks, is the whole change -- it exists
        // to establish that the SC1090 is the LAST thing in the wire path, not
        // as a proposal for zapo's source.
        const prev = this.committedGlobals.get(id)
        let same = false
        if (prev === undefined) {
            same = false
        } else if (prev === null) {
            same = value === null
        } else if (value === null) {
            same = false
        } else if (typeof prev === 'number' && typeof value === 'number') {
            same = prev === value
        } else if (typeof prev === 'string' && typeof value === 'string') {
            same = prev === value
        } else if (typeof prev === 'boolean' && typeof value === 'boolean') {
            same = prev === value
        }
        if (same) return
        writeGlobalAttribute(this.writer, id, value)
        this.committedGlobals.set(id, value)
    }

    /**
     * Appends one event: re-stamps `commitTime` (id 47, unix seconds), writes
     * the event header carrying `weight`, then each present field in order (the
     * last field flagged so the decoder can close the event group).
     */
    writeEvent(
        commitTimeMs: number,
        eventId: number,
        weight: number,
        fields: readonly WamResolvedField[]
    ): void {
        writeGlobalAttribute(this.writer, COMMIT_TIME_GLOBAL_ID, Math.floor(commitTimeMs / 1000))
        const lastIndex = fields.length - 1
        writeEventHeader(this.writer, eventId, weight, lastIndex >= 0)
        for (let i = 0; i <= lastIndex; i += 1) {
            const field = fields[i]
            writeField(this.writer, field.id, field.kind, field.value, i === lastIndex)
        }
        this.eventsWritten += 1
    }

    size(): number {
        return this.writer.size()
    }

    hasEvents(): boolean {
        return this.eventsWritten > 0
    }

    toBytes(): Uint8Array {
        return this.writer.toBytes()
    }
}
