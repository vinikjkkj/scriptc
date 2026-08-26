/* A `let` computed at the module's top level and then exported in the
 * module.exports table. Node copies its VALUE into the table at the export
 * statement, and this lowering exports the binding by REFERENCE -- which
 * can only differ if something assigns the binding AFTER that statement.
 * Nothing here can: the one write is a top-level try above the export, so
 * the binding has already taken its final value and the two readings are
 * the same value forever.
 *
 * The fence used to refuse the shape outright, which took pg/lib/defaults.js
 * -- and with it the whole `pg` package -- at run time. The order and
 * function-write controls that must STILL refuse live beside this file's
 * reasoning in lower-stmts.ts. */
'use strict';

const d = require('./defaults.js');
console.log(d.host, d.port);
console.log(typeof d.user === 'string' && d.user.length > 0);
