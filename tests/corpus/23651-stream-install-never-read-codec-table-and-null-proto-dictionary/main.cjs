"use strict"
// The program decodes and encodes through the table codecs. The streaming
// install in lib.cjs is never read, so it is not run.
var iconv = require("./lib.cjs")

console.log(iconv.encodingExists("utf8"), iconv.encodingExists("cp437"), iconv.encodingExists("nope"))
var b = iconv.encode("héllo", "utf8")
console.log(b, iconv.decode(b, "unicode11utf8"))
var t = iconv.encode("ABCx", "latin1")
console.log(t, iconv.decode(Buffer.from([0x80, 0x82, 0x41, 0x9f]), "cp437"))
console.log(iconv.decode(Buffer.from([0x81, 0x83]), 437))
try { iconv.getDecoder("klingon") } catch (e) { console.log(e.message) }
var d = iconv.getDecoder("latin1")
console.log(d.write(Buffer.from([0x80, 0x8f])), d.end())
