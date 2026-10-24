'use strict';
// Method entries in a module.exports table (`_clear() {}`, `async m() {}`, `'quoted'() {}`) beside plain entries.
const t = require('./9001-module-table-methods-modules/tbl.cjs');
console.log(t.localDate(3), t._clear(), typeof t._clear, t.name, t.count());
console.log(t.describe(), t.plain, Object.keys(t).join(','));
t._clear();
console.log(t.count(), t['quoted-name']());
t.asyncOne().then((v) => console.log('async', v));
console.log(JSON.stringify(t.plain), 'x' in t);
