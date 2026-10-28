"use strict"
// `X(...)` and `ns.X(...)` where X is absent from the required module: Node
// evaluates the arguments, then throws "X is not a function" at the call.
const ns = require("./cf.cjs")
function side(t) {
  console.log("arg", t)
  return t
}
function callDestructured() {
  const { CloudflareSocket } = require("./cf.cjs")
  return CloudflareSocket(side("call"))
}
function callMember() {
  return ns.CloudflareSocket(side("member-call"))
}
function callBare() {
  const { CloudflareSocket } = require("./cf.cjs")
  return CloudflareSocket()
}
try {
  console.log("destructured-call", "made", typeof callDestructured())
} catch (e) {
  console.log("destructured-call", "threw", e.name, e.message)
}
try {
  console.log("member-call", "made", typeof callMember())
} catch (e) {
  console.log("member-call", "threw", e.name, e.message)
}
try {
  console.log("zero-arg-call", "made", typeof callBare())
} catch (e) {
  console.log("zero-arg-call", "threw", e.name, e.message)
}
console.log("after", 2)
