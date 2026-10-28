"use strict"
// `new X(...)` where X is bound by `const { X } = require(...)` and the module
// (cf.cjs, the empty module a require-condition package entry resolves to)
// does not define X: Node evaluates the arguments, then throws
// "X is not a constructor". The bindings are const, so the absence is provable.
const cf = require("./cf.cjs")
function side(t) {
  console.log("arg", t)
  return t
}
function viaDestructuring(ssl) {
  const { CloudflareSocket } = require("./cf.cjs")
  return new CloudflareSocket(side(ssl))
}
function renamed() {
  const { CloudflareSocket: Sock } = require("./cf.cjs")
  return new Sock(side("renamed"))
}
function zeroArgs() {
  const { CloudflareSocket } = require("./cf.cjs")
  return new CloudflareSocket()
}
function memberNew() {
  return new cf.CloudflareSocket(side("member"))
}
function parenMember() {
  return new (cf.CloudflareSocket)(side("paren"))
}
function present() {
  const { default: d } = require("./cf.cjs")
  return typeof d
}
try {
  console.log("destructured", "made", typeof viaDestructuring(false))
} catch (e) {
  console.log("destructured", "threw", e.name, e.message)
}
try {
  console.log("renamed", "made", typeof renamed())
} catch (e) {
  console.log("renamed", "threw", e.name, e.message)
}
try {
  console.log("zero-args", "made", typeof zeroArgs())
} catch (e) {
  console.log("zero-args", "threw", e.name, e.message)
}
try {
  console.log("member", "made", typeof memberNew())
} catch (e) {
  console.log("member", "threw", e.name, e.message)
}
try {
  console.log("paren-member", "made", typeof parenMember())
} catch (e) {
  console.log("paren-member", "threw", e.name, e.message)
}
try {
  console.log("present-default", "made", typeof present())
} catch (e) {
  console.log("present-default", "threw", e.name, e.message)
}
console.log("after", 1)
