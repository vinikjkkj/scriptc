"use strict"

// The stream module is dependency-injected: this factory only defines ES5
// subclasses of its Transform and hands them back.
module.exports = function (streamModule) {
  var Transform = streamModule.Transform

  function EncoderStream (conv, options) {
    this.conv = conv
    options = options || {}
    options.decodeStrings = false
    Transform.call(this, options)
  }

  EncoderStream.prototype = Object.create(Transform.prototype, {
    constructor: { value: EncoderStream }
  })

  EncoderStream.prototype._transform = function (chunk, encoding, done) {
    if (typeof chunk !== "string") return done(new Error("needs strings"))
    var res = this.conv.write(chunk)
    if (res && res.length) this.push(res)
    done()
  }

  EncoderStream.prototype._flush = function (done) {
    var res = this.conv.end()
    if (res && res.length) this.push(res)
    done()
  }

  EncoderStream.prototype.collect = function (cb) {
    var chunks = []
    this.on("error", cb)
    this.on("data", function (chunk) { chunks.push(chunk) })
    this.on("end", function () { cb(null, Buffer.concat(chunks)) })
    return this
  }

  function DecoderStream (conv, options) {
    this.conv = conv
    options = options || {}
    options.encoding = this.encoding = "utf8"
    Transform.call(this, options)
  }

  DecoderStream.prototype = Object.create(Transform.prototype, {
    constructor: { value: DecoderStream }
  })

  DecoderStream.prototype._transform = function (chunk, encoding, done) {
    var res = this.conv.write(chunk)
    if (res && res.length) this.push(res, this.encoding)
    done()
  }

  return {
    EncoderStream: EncoderStream,
    DecoderStream: DecoderStream
  }
}
