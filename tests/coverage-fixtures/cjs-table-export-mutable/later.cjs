// The table entry's ONE soundness condition, as a negative control (the
// whole-export root's twin, cjs-whole-export-rebound). Node copies the
// binding's VALUE into module.exports at the export statement; this
// lowering exports it by REFERENCE. Admitting that needs "nothing can
// rebind it afterwards", and this file rebinds it on the next line, so the
// fence stands: Node answers 1 here and the reference would answer 2.
'use strict';
let n = 1;
module.exports = { n };
n = 2;
