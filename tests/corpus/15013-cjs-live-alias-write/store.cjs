'use strict'
module.exports = { count: 0, label: 'x' }
module.exports.self = module.exports
module.exports.show = function () { return module.exports.count + ':' + module.exports.label }
