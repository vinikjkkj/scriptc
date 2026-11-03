// REFUSED AT COMPILE TIME. Same install shape as js-stream-install-read-by-live-code,
// but the install itself prints: running it is observable, so it cannot be skipped,
// and it needs the stream module as a value.
"use strict"
var util = require("util")

module.exports.enableStreamingAPI = function enableStreamingAPI (streamModule) {
  var Transform = streamModule.Transform
  console.log("installing")
  function UpperStream (options) { Transform.call(this, options) }
  util.inherits(UpperStream, Transform)
  module.exports.UpperStream = UpperStream
}

var streamModule
try {
  streamModule = require("stream")
} catch (e) {}

if (streamModule && streamModule.Transform) {
  module.exports.enableStreamingAPI(streamModule)
}
