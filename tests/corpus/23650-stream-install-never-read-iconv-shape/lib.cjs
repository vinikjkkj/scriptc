"use strict"

var Buffer = require("buffer").Buffer

// Public API (what the program calls).
module.exports.encode = function encode (str) {
  return Buffer.from("" + str, "utf8")
}

module.exports.decode = function decode (buf) {
  return buf.toString("utf8")
}

module.exports.getDecoder = function getDecoder (name) {
  return { name: name, write: function (b) { return b.toString("latin1") }, end: function () { return "" } }
}

module.exports.supportsStreams = false

// Streaming API, enabled when the stream module is available (the iconv-lite
// shape). Nothing in this program reads what it installs.
module.exports.enableStreamingAPI = function enableStreamingAPI (streamModule) {
  if (module.exports.supportsStreams) { return }

  var streams = require("./streams.cjs")(streamModule)

  module.exports.EncoderStream = streams.EncoderStream
  module.exports.DecoderStream = streams.DecoderStream

  module.exports.encodeStream = function encodeStream (name) {
    return new module.exports.EncoderStream(module.exports.getDecoder(name), {})
  }

  module.exports.decodeStream = function decodeStream (name) {
    return new module.exports.DecoderStream(module.exports.getDecoder(name), {})
  }

  module.exports.supportsStreams = true
}

var streamModule
try {
  streamModule = require("stream")
} catch (e) {}

if (streamModule && streamModule.Transform) {
  module.exports.enableStreamingAPI(streamModule)
} else {
  module.exports.encodeStream = module.exports.decodeStream = function () {
    throw new Error("Streaming API is not enabled.")
  }
}
