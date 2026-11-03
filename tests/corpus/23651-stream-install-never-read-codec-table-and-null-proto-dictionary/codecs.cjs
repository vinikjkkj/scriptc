"use strict"

var mergeModules = require("./merge.cjs")

// Put all encoding/alias/codec definitions to single object and export it.
var modules = [
  require("./codecs-plain.cjs"),
  require("./codecs-table.cjs")
]

for (var i = 0; i < modules.length; i++) {
  var module = modules[i]
  mergeModules(exports, module)
}
