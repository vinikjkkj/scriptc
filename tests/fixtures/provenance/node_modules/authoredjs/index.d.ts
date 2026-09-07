// The hand-written declaration half of an authored-JavaScript package: the
// types live here, the bodies live in the `index.js` beside it. Mapping the
// package to the `.js` directly would compile the values and LOSE these, so
// the mapper takes the `.d.ts` and the declaration-twin machinery supplies
// the bodies.
//
// The tables are declared MEMBER BY MEMBER, which is what a generated `.d.ts`
// of this kind does (@vinikjkkj/wa-wam declares 30k lines of exactly this
// shape) — not as an index signature, which neither lane compiles a nested
// read out of.
export type Channel = 'private' | 'realtime' | 'regular'

export declare const PROTOCOL_VERSION: 5

export declare const CHANNELS: readonly Channel[]

export declare const CHANNEL_WIRE_CODES: {
    readonly regular: 0
    readonly realtime: 1
    readonly private: 2
}

export declare const ENUMS: {
    readonly UI_ACTION_TYPE: {
        readonly id: 11
        readonly values: {
            readonly CHAT_OPEN: 3
            readonly CHAT_CLOSE: 4
        }
    }
    readonly SIZE_BUCKET: {
        readonly id: 12
        readonly values: {
            readonly LT64: 2
            readonly LT128: 3
        }
    }
}

export declare function channelCount(): number
