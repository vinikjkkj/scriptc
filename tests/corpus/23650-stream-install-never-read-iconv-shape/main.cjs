"use strict"
// The program uses the wrapper's buffer API only; the streaming install in
// lib.cjs is never read, so it is not run.
var lib = require("./lib.cjs")

var b = lib.encode("héllo wörld")
console.log(b.length, b)
console.log(lib.decode(b))
var d = lib.getDecoder("latin1")
console.log(d.name, d.write(Buffer.from([0x61, 0xe9, 0x62])) === "aéb", d.end() === "")
