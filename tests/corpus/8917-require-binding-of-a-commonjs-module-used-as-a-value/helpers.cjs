'use strict';
// An all-function module, then a mixed one: neither spells `export =`, so the module object is the
// exports table itself (what mysql2's helpers.js looks like to its requirers).
exports.escapeField = function (field) { return '`' + String(field) + '`'; };
exports.size = (n = 2) => n * 3;
exports.label = 'L';
