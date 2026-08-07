// A GENERATED CommonJS module: one merged `var` declarator list, a root
// object built at run time, and the whole export spelled as the last COMMA
// OPERAND of the file's last expression statement. pbjs `--target
// static-module --wrap commonjs` through esbuild and terser emits exactly
// this, and the export operand is followed by more of the module's own body.
'use strict';
var e, n, j = makeRoot();
function makeRoot() { return {}; }
j.wire = ((n = {}), (n.tag = 'from-the-comma'), (n.twice = function (v) { return v * 2; }), (e = n), n), module.exports = j;
// Node reaches this line: the export was an operand, not the end of the
// module. A fence at the export would have taken it down with it.
j.late = 'attached after the export';
