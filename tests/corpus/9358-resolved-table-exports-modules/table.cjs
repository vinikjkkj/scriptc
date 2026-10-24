'use strict';
// The export is a const literal whose entries are expressions. The const's own declaration evaluates them once; the export reads the same values back, so the identity of an array entry is kept.
const parts = [1, 2];
const shared = [7, 8];
const table = { ca: [...parts, 3], k: parts.length, shared: shared };
module.exports = table;
module.exports.extra = 'x';
