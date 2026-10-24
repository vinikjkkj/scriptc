'use strict';
// An object record that crosses into a dynamic slot and comes back must keep its identity: Node returns the very same object every time.
function make(n) { return { n: n, tag: 'r' + n }; }
const boxed = [];
function pass(x) { boxed.push(x); return x; }
const a = make(1);
const viaDyn = pass(a);
console.log(viaDyn === a, boxed[0] === a);
const again = pass(a);
console.log(again === viaDyn, boxed.length);
const holder = { slot: a };
const got = holder.slot;
console.log(got === a, got.tag);
function pick(flag) { return flag ? a : 'other'; }
const p1 = pick(true);
const p2 = pick(true);
console.log(p1 === a, p2 === p1, p1 === p2);
const mixed = [a, 'z', a];
console.log(mixed[0] === mixed[2], mixed[0] === a, typeof mixed[1]);
