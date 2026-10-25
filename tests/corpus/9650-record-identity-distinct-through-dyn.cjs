'use strict';
// Two distinct records with equal contents must stay distinct through a dynamic slot, and each must still be identical to itself after the crossing: the origin answers identity, not the contents.
function pass(x) { return x; }
const holder = {};
function mk() { return { len: 2 }; }
const x = mk();
const y = mk();
holder.a = x;
holder.b = y;
const ax = pass(x);
const ay = pass(y);
console.log(ax === ay, ax === holder.a, ay === holder.b);
