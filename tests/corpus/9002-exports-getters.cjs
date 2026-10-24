'use strict';
// Accessor exports: exports.__defineGetter__ and Object.defineProperty(exports, K, { get }) run the getter on every read.
const g = require('./9002-exports-getters-modules/acc.cjs');
console.log(g.Count, g.Count, g.Count, g.counter());
console.log(g.Label, typeof g.Label, g.Label.length);
console.log(g.Shape.sides, g.Shape.sides + 1, g.plain);
console.log(g.Tail, g.Tail);
console.log(g.counter());
