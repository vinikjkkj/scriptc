'use strict'
class BaseError extends Error {
  tag() { return "base:" + this.message }
}
class ReplyError extends BaseError {
  constructor(message) {
    super(message)
    this.replied = true
  }
}
class Plain {
  constructor(v) { this.v = v }
}
class PlainChild extends Plain {}
module.exports = { BaseError, ReplyError, Plain, PlainChild }
