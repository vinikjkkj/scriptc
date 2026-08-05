'use strict'
// Present on disk and loaded by Node — which is exactly why "ROWS is not
// defined" was the wrong answer. This build never compiles it.
const ROWS = Object.freeze([Object.freeze({ name: 'a', n: 1 })])
module.exports = { ROWS }
