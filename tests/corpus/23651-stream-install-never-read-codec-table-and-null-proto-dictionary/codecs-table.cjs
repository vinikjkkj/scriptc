"use strict"

module.exports = {
  437: "cp437",
  cp437: { type: "_table", chars: "ÇüéâäàåçêëèïîìÄÅ" },
  latin1: { type: "_table", chars: "ABCDEFGHIJKLMNOP" },
  _table: TableCodec
}

function TableCodec (codecOptions, iconv) {
  this.enc = codecOptions.encodingName
  this.chars = codecOptions.chars
  this.iconv = iconv
  this.encoder = TableEncoder
  this.decoder = TableDecoder
}

function TableEncoder (options, codec) {
  this.chars = codec.chars
  this.fallback = codec.iconv.defaultChar
}
TableEncoder.prototype.write = function (s) {
  var out = Buffer.alloc(s.length)
  for (var i = 0; i < s.length; i++) {
    var at = this.chars.indexOf(s[i])
    out[i] = at < 0 ? this.fallback.charCodeAt(0) : 0x80 + at
  }
  return out
}
TableEncoder.prototype.end = function () { return undefined }

function TableDecoder (options, codec) {
  this.chars = codec.chars
  this.fallback = codec.iconv.defaultChar
}
TableDecoder.prototype.write = function (b) {
  var out = ""
  for (var i = 0; i < b.length; i++) out += b[i] >= 0x80 && b[i] - 0x80 < this.chars.length ? this.chars[b[i] - 0x80] : String.fromCharCode(b[i])
  return out
}
TableDecoder.prototype.end = function () { return undefined }
