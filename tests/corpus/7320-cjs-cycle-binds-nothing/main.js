// A require cycle whose closing edge BINDS NOTHING: `require('./b.js')`
// for its effects only. Node hands b the partial exports of a, but no
// name is bound through the edge, so nothing can observe the partial
// initialization and the run-once %init guards reproduce Node's order
// exactly. This lived in tests/diagnostics as the SC1016 case "the cycle
// closes through a require() edge" until admission learned CommonJS's own
// rule; it compiles now, and the claim worth gating is that the compiled
// program agrees with Node — which the corpus checks and a snapshot of a
// refusal never did.
'use strict';

console.log('main: start');
const { A } = require('./a.js');
console.log(A);
