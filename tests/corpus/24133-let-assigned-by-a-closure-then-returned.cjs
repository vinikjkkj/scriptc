"use strict";
// A `let x;` (or `= undefined` / `= null`) that a nested function assigns and the declaring function returns: tsc's flow type at `return x`
// is `undefined` because closure assignments are invisible to it, which used to drop the returned value.
function viaForEach() { let out; [1, 2].forEach((n) => { out = "x" + n; }); return out; }
function viaCall() { let out; const f = () => { out = "y"; }; f(); return out; }
function viaNumber() { let out; [5].forEach((n) => { out = n * 2; }); return out; }
function viaInit() { let out = undefined; [1].forEach(() => { out = "z"; }); return out; }
function viaNull() { let found = null; [1, 2, 3].forEach((n) => { if (n === 2) found = n; }); return found; }
function viaVar() { var last; [7, 8].forEach(function (n) { last = n; }); return last; }
function counter() { let count; const bump = () => { count = (count || 0) + 1; }; bump(); bump(); return count; }
function incr() { let n; const f = () => { n = 1; n++; }; f(); return n; }
function untouched() { let never; [1].forEach(() => {}); return never; }
function shadowed() { let out; [1].forEach(() => { let out = "inner"; return out; }); return out; }
console.log(viaForEach(), viaCall(), viaNumber(), viaInit(), viaNull(), viaVar(), counter(), incr(), untouched(), shadowed());
console.log(typeof viaForEach(), typeof viaNumber(), [viaForEach(), viaNull()].join(","));
