// REFUSED AT COMPILE TIME. The install adds a method to the REAL Transform.prototype
// (not to a fresh subclass prototype): every stream in the program sees it, so
// the install is observable and cannot be skipped.
"use strict"
var util = require("util")

module.exports.enableStreamingAPI = function enableStreamingAPI (streamModule) {
  var Transform = streamModule.Transform
  function UpperStream (options) { Transform.call(this, options) }
  util.inherits(UpperStream, Transform)
  Transform.prototype.shout = function () { return "!" }
  module.exports.UpperStream = UpperStream
}

var streamModule
try {
  streamModule = require("stream")
} catch (e) {}

if (streamModule && streamModule.Transform) {
  module.exports.enableStreamingAPI(streamModule)
}
