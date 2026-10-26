"use strict"
// The iconv-lite getEncoder/getDecoder shape: the BOM wrappers are reached through
// a require() binding (a namespace object) and constructed with `new ns.Ctor(...)`.
var bomHandling = require("./bom-handling.cjs")

module.exports.getEncoder = function getEncoder (encoding, options) {
  var encoder = { write: function (s) { return "E(" + s + ")" }, end: function () { return "END" } }
  if (options && options.addBOM) { encoder = new bomHandling.PrependBOM(encoder, options) }
  return encoder
}

module.exports.getDecoder = function getDecoder (encoding, options) {
  var decoder = { write: function (b) { return "D(" + b + ")" }, end: function () { return "DEND" } }
  if (!(options && options.stripBOM === false)) { decoder = new bomHandling.StripBOM(decoder, options) }
  return decoder
}
