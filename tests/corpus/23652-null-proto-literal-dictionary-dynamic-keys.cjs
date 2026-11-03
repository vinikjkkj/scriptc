"use strict"
// `{ __proto__: null }` builds a prototype-less object with NO own keys (the
// same as Object.create(null)); it is the dictionary idiom iconv-lite uses for
// its encoding table, filled through run-time keys.
function merge (target, source) {
  for (var key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key] }
  }
}

var table = { __proto__: null }
console.log(table, Object.keys(table).length)
merge(table, { 437: "cp437", utf8: { type: "_internal" }, alias: "utf8" })
merge(table, { 850: "cp850", z: 1 })
console.log(table)
console.log(Object.keys(table))
console.log("toString" in table, "alias" in table, "__proto__" in table, typeof table.toString)
console.log(table["437"], table.utf8, table.missing)
console.log(Boolean(table), table ? "truthy" : "falsy")

var holder = { cache: { "__proto__": null }, other: 1 }
holder.cache["k" + 1] = "v1"
holder.cache["k" + 2] = "v2"
console.log(holder, Object.keys(holder.cache))

function lookup (dict, name) {
  var v = dict[name]
  switch (typeof v) {
    case "string": return "alias:" + v
    case "object": return "def:" + v.type
    default: return "none"
  }
}
console.log(lookup(table, "437"), lookup(table, "utf8"), lookup(table, "nope"), lookup(table, "toString"))
