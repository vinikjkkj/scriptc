// Shaped like a data package that publishes the file it authored: flat
// index.js beside a hand-written index.d.ts, one lifecycle-free script, no
// `exports` map and no build output.
'use strict'
const TABLE = Object.freeze({ a: 1, b: 2 })
module.exports = { TABLE }
