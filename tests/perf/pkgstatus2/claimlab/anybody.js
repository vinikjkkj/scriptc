'use strict'
// A body whose export INFERS as `any` -- the ordinary shape of bundler-emitted
// JS, and the reason a declaration can win with no assignability check to stop
// it. No cast is written by the consumer.
function makeCodec() {
    return JSON.parse('{"count":7}') && {
        find(k) {
            return k === 'hit' ? 'FOUND' : null
        },
        count: 7
    }
}
module.exports = { makeCodec }
