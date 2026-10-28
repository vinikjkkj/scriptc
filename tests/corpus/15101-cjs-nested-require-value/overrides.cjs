'use strict'
const types = require('./types.cjs')
function TypeOverrides(userTypes) { this._types = userTypes || types; this.text = {}; this.binary = {} }
TypeOverrides.prototype.getTypeParser = function (oid, f) { return this._types.getTypeParser(oid, f) }
module.exports = TypeOverrides
