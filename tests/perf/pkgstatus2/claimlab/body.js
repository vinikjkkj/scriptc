'use strict'
// The BODY. Three parameters, and the third one decides the answer.
function makeCodec() {
    return {
        tag: 'body',
        encode(a, b, c) {
            return a + ':' + b + ':' + (c === undefined ? 'MISSING' : c)
        }
    }
}
module.exports = { makeCodec }
