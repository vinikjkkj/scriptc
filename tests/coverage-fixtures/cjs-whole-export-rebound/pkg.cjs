// The whole-export root's ONE soundness condition, as a negative control.
// Node copies module.exports's VALUE at the export statement, so storage of
// its own IS that copy — but a requirer read that resolves through the alias
// path reads the LIVE binding, and the two views part company the moment
// anything rebinds the root. This file rebinds it after the export, so no
// storage registers and the export keeps its fence.
'use strict';
var j = makeRoot();
function makeRoot() { return {}; }
j.parts = { tag: 'exported' };
module.exports = j;
j = { parts: { tag: 'never exported' } };
