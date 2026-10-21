// The nested scope. Its own package.json has no "exports" either, so
// BOTH names are MODULE_NOT_FOUND from here — the inner one by rule 1,
// the outer one by rule 2.
'use strict';

var inner = 'corpus-selfref-inner';
var outer = 'corpus-selfref-scope';
var out = [];
try { require(inner); out.push('inner:resolved'); }
catch (e) { out.push('inner:' + e.code); }
try { require(outer); out.push('outer:resolved'); }
catch (e) { out.push('outer:' + e.code); }
exports.report = out.join(' ');
