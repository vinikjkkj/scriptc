"use strict"

module.exports = {
  utf8: { type: "_plain", bomAware: true },
  unicode11utf8: "utf8",
  _plain: PlainCodec
}

function PlainCodec (codecOptions, iconv) {
  this.enc = codecOptions.encodingName
  this.bomAware = codecOptions.bomAware
  this.mark = iconv.defaultChar
  this.iconv = iconv
  this.encoder = PlainEncoder
  this.decoder = PlainDecoder
}

function PlainEncoder (options, codec) {
  this.codec = codec
  this.mark = codec.iconv.defaultChar
}
PlainEncoder.prototype.write = function (s) { return Buffer.from(s, "utf8") }
PlainEncoder.prototype.end = function () { return undefined }

function PlainDecoder (options, codec) {
  this.codec = codec
}
PlainDecoder.prototype.write = function (b) { return b.toString("utf8") }
PlainDecoder.prototype.end = function () { return undefined }
