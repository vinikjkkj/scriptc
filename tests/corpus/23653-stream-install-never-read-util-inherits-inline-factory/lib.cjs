"use strict"

var util = require("util")

module.exports.supportsStreams = false

module.exports.transcode = function transcode (text, from, to) {
  return Buffer.from(text, from).toString(to)
}

module.exports.collectLength = function collectLength (parts) {
  var n = 0
  for (var i = 0; i < parts.length; i++) n += parts[i].length
  return n
}

// The streaming wrapper classes are built in place (util.inherits over the
// Transform of the injected stream module); nothing reads them.
module.exports.enableStreamingAPI = function enableStreamingAPI (streamModule) {
  if (module.exports.supportsStreams) { return }
  var Transform = streamModule.Transform
  var PassThrough = streamModule.PassThrough

  function UpperStream (options) {
    Transform.call(this, options)
    this.count = 0
  }
  util.inherits(UpperStream, Transform)
  UpperStream.prototype._transform = function (chunk, enc, done) {
    this.count++
    this.push(String(chunk).toUpperCase())
    done()
  }
  UpperStream.prototype._flush = function (done) {
    this.push("[" + this.count + "]")
    done()
  }

  function TeeStream (options) {
    PassThrough.call(this, options)
  }
  util.inherits(TeeStream, PassThrough)

  module.exports.UpperStream = UpperStream
  module.exports.TeeStream = TeeStream
  module.exports.upperStream = function upperStream (options) { return new UpperStream(options) }
  module.exports.supportsStreams = true
}

var streamModule
try {
  streamModule = require("stream")
} catch (e) {}

if (streamModule && streamModule.Transform) {
  module.exports.enableStreamingAPI(streamModule)
} else {
  module.exports.upperStream = function () { throw new Error("Streaming API is not enabled.") }
}
