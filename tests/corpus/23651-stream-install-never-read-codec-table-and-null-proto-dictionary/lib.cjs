"use strict"

var mergeModules = require("./merge.cjs")
var raw = require("./codecs.cjs")

module.exports.supportsStreams = false
module.exports.defaultChar = "?"

// All codecs and aliases, loaded on first use.
module.exports.encodings = null
module.exports._codecDataCache = { __proto__: null }

module.exports.getCodec = function getCodec (encoding) {
  if (!module.exports.encodings) {
    module.exports.encodings = { __proto__: null }
    mergeModules(module.exports.encodings, raw)
  }

  var enc = String(encoding).toLowerCase().replace(/[^0-9a-z]|:\d{4}$/g, "")
  var codecOptions = {}
  while (true) {
    var codec = module.exports._codecDataCache[enc]
    if (codec) { return codec }

    var codecDef = module.exports.encodings[enc]

    switch (typeof codecDef) {
      case "string":
        enc = codecDef
        break

      case "object":
        for (var key in codecDef) { codecOptions[key] = codecDef[key] }
        if (!codecOptions.encodingName) { codecOptions.encodingName = enc }
        enc = codecDef.type
        break

      case "function":
        if (!codecOptions.encodingName) { codecOptions.encodingName = enc }
        codec = new codecDef(codecOptions, module.exports)
        module.exports._codecDataCache[codecOptions.encodingName] = codec
        return codec

      default:
        throw new Error("Encoding not recognized: '" + encoding + "' (searched as: '" + enc + "')")
    }
  }
}

module.exports.encodingExists = function encodingExists (enc) {
  try {
    module.exports.getCodec(enc)
    return true
  } catch (e) {
    return false
  }
}

module.exports.getEncoder = function getEncoder (encoding, options) {
  var codec = module.exports.getCodec(encoding)
  return new codec.encoder(options, codec)
}

module.exports.getDecoder = function getDecoder (encoding, options) {
  var codec = module.exports.getCodec(encoding)
  return new codec.decoder(options, codec)
}

module.exports.decode = function decode (buf, encoding, options) {
  var decoder = module.exports.getDecoder(encoding, options)
  var res = decoder.write(buf)
  var trail = decoder.end()
  return trail ? (res + trail) : res
}

module.exports.encode = function encode (str, encoding, options) {
  var encoder = module.exports.getEncoder(encoding, options)
  var res = encoder.write(str)
  var trail = encoder.end()
  return (trail && trail.length > 0) ? Buffer.concat([res, trail]) : res
}

// Streaming API, enabled when the stream module is available.
module.exports.enableStreamingAPI = function enableStreamingAPI (streamModule) {
  if (module.exports.supportsStreams) { return }

  var streams = require("./streams.cjs")(streamModule)

  module.exports.EncoderStream = streams.EncoderStream
  module.exports.DecoderStream = streams.DecoderStream

  module.exports.encodeStream = function encodeStream (encoding, options) {
    return new module.exports.EncoderStream(module.exports.getEncoder(encoding, options), options)
  }

  module.exports.decodeStream = function decodeStream (encoding, options) {
    return new module.exports.DecoderStream(module.exports.getDecoder(encoding, options), options)
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
