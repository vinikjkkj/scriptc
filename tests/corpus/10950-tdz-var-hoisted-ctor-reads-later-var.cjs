"use strict"
// A module `var` of an untyped `new Array(n)` (checker type any[], no mapping)
// read from a hoisted constructor that is exported ABOVE the var, and called
// only after the module body has finished. The dbcs-codec shape: the reads sit
// textually BELOW the declaration, and the exported function's only activation
// is an inert `exports.X = F` store, so no call can run before the array exists.
//
// BEFORE this fix the reads were SC1030 ("the reference to 'UNASSIGNED_NODE'
// above its 'var' declaration"); the message was wrong, the reads are below.
exports._dbcs = DBCSCodec

var UNASSIGNED = -1
var GB18030_CODE = -2
var NODE_START = -1000
var UNASSIGNED_NODE = new Array(0x100)
for (var i = 0; i < 0x100; i++) { UNASSIGNED_NODE[i] = UNASSIGNED }

function DBCSCodec (codecOptions) {
  this.encodingName = codecOptions.encodingName
  this.decodeTables = []
  this.decodeTables[0] = UNASSIGNED_NODE.slice(0)
  this.gb = GB18030_CODE
}
DBCSCodec.prototype.root = function () { return this.decodeTables[0][7] }
DBCSCodec.prototype.node = function () { return UNASSIGNED_NODE.length }
DBCSCodec.prototype.push = function () {
  this.decodeTables.push(UNASSIGNED_NODE.slice(0))
  return this.decodeTables.length + NODE_START
}

var c = new DBCSCodec({ encodingName: "cp936" })
console.log(c.encodingName, c.root(), c.node(), c.decodeTables[0].length, c.gb)
console.log(c.push(), c.decodeTables.length)
var d = new exports._dbcs({ encodingName: "gbk" })
console.log(d.encodingName, d.root(), d.node())
