'use strict';
// A CommonJS module exports a const literal whose entries are expressions (`module.exports = table`). Requirers read the entries, and the entry array is the same object as the const's own property.
const t = require('./9358-resolved-table-exports-modules/table.cjs');
console.log(t.ca.length, t.ca[2], t.k, t.extra);
console.log(t.shared[1], t.shared.length);
t.shared.push(9);
console.log(t.shared.length);
