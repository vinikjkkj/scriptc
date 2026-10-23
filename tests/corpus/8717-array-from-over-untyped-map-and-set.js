// Array.from over a Map, a Set or an array the checker types as one, reached
// through a dyn value: the spread walk drains each into a fresh array (a
// Map's [key, value] pairs, a Set's elements, an array's copy), which is what
// Array.from builds for these iterables.
'use strict';

function mk() { return new Map(); }
function mks() { return new Set(); }
const m = mk(); m.set("a", 1); m.set("b", 2);
const s = mks(); s.add(3); s.add(4);
console.log(Array.from(m), Array.from(s), Array.from(m).length);
const arr = [1, 2, 3];
function copy() { const a = []; a.push(1); a.push(2); return Array.from(a); }
console.log(copy());
