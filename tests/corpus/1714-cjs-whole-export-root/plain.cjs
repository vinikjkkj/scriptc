// The hand-written prologue spelling of the same thing: the root is declared
// bare and WRITTEN by a later top-level statement, so it is a `var` binding
// the export cannot alias to — but every write to it runs before the export.
'use strict';
var j, parts;
j = makeRoot();
function makeRoot() { return {}; }
parts = { tag: 'from-the-statement', n: 6 };
j.parts = parts;
module.exports = j;
