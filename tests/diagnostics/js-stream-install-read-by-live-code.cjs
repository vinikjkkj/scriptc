// REFUSED AT COMPILE TIME. The streaming install (a feature probe on the
// stream module that stores ES5 Transform subclasses into module.exports) is
// skipped only when nothing can read what it installs. Here live code reads
// one installed field, so the install must run, and running it needs the
// stream module as a value and an ES5 subclass of a runtime class.
"use strict"
var util = require("util")

module.exports.enableStreamingAPI = function enableStreamingAPI (streamModule) {
  var Transform = streamModule.Transform
  function UpperStream (options) { Transform.call(this, options) }
  util.inherits(UpperStream, Transform)
  UpperStream.prototype._transform = function (chunk, enc, done) { this.push(String(chunk).toUpperCase()); done() }
  module.exports.UpperStream = UpperStream
}

var streamModule
try {
  streamModule = require("stream")
} catch (e) {}

if (streamModule && streamModule.Transform) {
  module.exports.enableStreamingAPI(streamModule)
}

console.log(typeof module.exports.UpperStream)
