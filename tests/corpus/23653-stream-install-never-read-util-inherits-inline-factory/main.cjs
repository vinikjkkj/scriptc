"use strict"
var lib = require("./lib.cjs")

console.log(lib.transcode("héllo", "utf8", "latin1"), lib.transcode("héllo", "utf8", "hex"))
console.log(lib.collectLength(["ab", "cde", ""]))
console.log(lib.transcode("aGk=", "base64", "utf8"))
