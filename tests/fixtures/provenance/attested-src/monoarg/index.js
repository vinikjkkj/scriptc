// AUTO-GENERATED -- do not edit. A package with NO BUILD STEP, the authoredjs
// shape, with the ONE property authoredjs deliberately does not have: its
// published surface is FUNCTIONS THAT TAKE ARGUMENTS.
//
// authoredjs/index.js says, in a comment, why it is parameterless: a parameter
// "is `unknown` inside the body no matter what the `.d.ts` beside it declares",
// and `CHANNEL_WIRE_CODES[channel]` fenced [SC1090] while `switch (channel)`
// fenced [SC1100]. That sentence is true of the lane AS BUILT and false as a
// statement about the lane: implicit-any monomorphization is exactly the gate
// that makes such a parameter known, and it reads OFF here for a PATH reason --
// the mapped file lives under the attested source tree, which carries no
// node_modules segment for a path-shaped selector to read a package name out
// of. This file exists so the suite can tell those two apart.
'use strict'

const WIRE_CODES = Object.freeze({
    regular: 0,
    realtime: 1,
    private: 2
})

// The [SC1090] site: indexing a record with a parameter.
function wireCodeOf(channel) {
    return WIRE_CODES[channel]
}

// The [SC1100] site: switching on a parameter.
function bucketOf(channel) {
    switch (channel) {
        case 'private':
            return 2
        case 'realtime':
            return 1
        default:
            return 0
    }
}

module.exports = {
    WIRE_CODES,
    wireCodeOf,
    bucketOf
}
