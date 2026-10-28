'use strict'
module.exports = { a: 1 }
module.exports.b = 2
module.exports.bump = function () { module.exports.a++; return module.exports.a }
module.exports.readA = function () { return module.exports.a }
module.exports.add = function (k, v) { module.exports[k] = v; return Object.keys(module.exports).length }
