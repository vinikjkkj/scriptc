'use strict'
// The BODY, three ways a declaration can UNDER-claim it.
function makeCodec() {
    return {
        // (1) narrower than declared: the body can return null, a declaration
        //     that says `string` under-claims the union.
        find(k) {
            return k === 'hit' ? 'FOUND' : null
        },
        // (2) the body has a member a declaration may omit entirely.
        extra() {
            return 'extra-is-here'
        },
        // (3) the body's property is a number; a declaration may say string.
        count: 7
    }
}
module.exports = { makeCodec }
