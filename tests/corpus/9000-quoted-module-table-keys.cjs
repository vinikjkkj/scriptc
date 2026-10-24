'use strict';
// Quoted and bare keys of a module.exports table name the same exports: a bracket read of
// the numeric-string key, a dot read of the quoted identifier key, and the whole table.
const table = require('./9000-quoted-module-table-keys-modules/charsets.cjs');
console.log(table['437'], table['28605'], table.win874, table['win874']);
console.log(table.windows874.type, table.windows874.chars, table['windows874'].chars.length);
console.log(table.ascii.chars, table.plain, typeof table.plain);
console.log(Object.keys(table).join(','));
console.log(JSON.stringify(table));
