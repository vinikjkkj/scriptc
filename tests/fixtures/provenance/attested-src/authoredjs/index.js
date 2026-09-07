// AUTO-GENERATED — do not edit. A package with NO BUILD STEP: what is
// published IS what was authored, so this file is both the dist artifact and
// the attested source. @vinikjkkj/wa-wam's `index.js` is this shape — a
// CommonJS module of frozen tables ending in one `module.exports` object
// literal — and it is the reason the authored-JavaScript mapping exists.
'use strict'

const PROTOCOL_VERSION = 5

const CHANNELS = Object.freeze(['private', 'realtime', 'regular'])

const CHANNEL_WIRE_CODES = Object.freeze({
    regular: 0,
    realtime: 1,
    private: 2
})

const ENUMS = Object.freeze({
    UI_ACTION_TYPE: Object.freeze({
        id: 11,
        values: Object.freeze({ CHAT_OPEN: 3, CHAT_CLOSE: 4 })
    }),
    SIZE_BUCKET: Object.freeze({
        id: 12,
        values: Object.freeze({ LT64: 2, LT128: 3 })
    })
})

// PARAMETERLESS on purpose, and the reason is a limit of this whole lane. The
// mapped file is JavaScript, so a parameter is `unknown` inside the body no
// matter what the `.d.ts` beside it declares, and the first thing done with
// one refuses: `CHANNEL_WIRE_CODES[channel]` built and then threw `indexing
// records with non-string or non-number keys` from an [SC1090] fence, and
// `switch (channel)` built and threw `switch statements on 'unknown' values`
// from an [SC1100] one. Both were measured on this fixture.
//
// So the authored-JavaScript lane carries a package whose published surface is
// DATA (wa-wam's frozen tables — 0 fences over 11,044,135 bytes of emitted C)
// and does not yet carry one whose surface is FUNCTIONS THAT TAKE ARGUMENTS.
function channelCount() {
    return CHANNELS.length
}

module.exports = {
    PROTOCOL_VERSION,
    CHANNELS,
    CHANNEL_WIRE_CODES,
    ENUMS,
    channelCount
}
