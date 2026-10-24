'use strict';
const log = [];
function tag(x) { log.push(x); return x; }
function two(a, b) { return a + ':' + b; }
function none() { return 'n'; }
// interleaved declared and surplus effects, in source order
console.log(two(tag('a'), tag('b')), tag('c'), tag('d'), log.join(''));
// surplus console.log effect
function one(x) { return 'one ' + x; }
console.log(one(console.log('surplus-log')));
// surplus i++ and a declared read of the same variable
let i = 1;
function take1(x) { return x; }
console.log(take1(i, i++), i);
// receiver evaluated before surplus, method form, zero params
const objs = { k: 0, get() { this.k++; return this; }, m() { return 'm' + this.k; } };
console.log(objs.get().m(tag('s1')), objs.k, log.join(''));
class K { m() { return 'km'; } }
const kk = new K();
console.log(kk.m(tag('s2')), log.length);
// new-expression form with surplus
class P { constructor(x) { this.x = x; } }
console.log(new P(tag('x1'), tag('x2')).x, log.length);
class Z { constructor() { this.v = 1; } }
console.log(new Z(tag('z1')).v, log.length);
// callee with arguments object reads the surplus
function args1(a) { return arguments.length + ':' + arguments[1]; }
console.log(args1(1, tag('ar')), log.length);
// value-position and return-position surplus
function ret(x) { return x; }
function rr() { return ret(1, tag('r1')); }
console.log(rr(), log.length);
const v2 = none(tag('v2'));
console.log(v2, log.length);
// surplus void-valued call
function voidf() { log.push('vf'); }
console.log(none(voidf()), log.length);
// surplus call in an assignment and an array push
let acc = [];
acc.push(none(tag('p1')));
console.log(acc, log.length);
