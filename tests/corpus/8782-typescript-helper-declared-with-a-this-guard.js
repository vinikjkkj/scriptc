"use strict";
// tsc declares each of its helpers as `var __h = (this && this.__h) || function ...`.
// At a module's top level `this` is its (empty) exports object, so the helper is the
// function; classes and functions call it from inside their own bodies.
var __pick = (this && this.__pick) || function (source, keys) {
    const out = [];
    for (const k of keys) {
        if (source.has(k)) out.push(k + "=" + source.get(k));
    }
    return out;
};
var __tally = (this && this.__tally) || function (items, seed) {
    let n = seed;
    for (const it of items) n += it;
    return n;
};
class Report {
  constructor(rows) {
    this.rows = rows;
    this.total = __tally(rows, 0);
  }
  columns(keys) {
    return this.rows.length + ":" + __pick(new Map([["a", 1], ["b", 2], ["c", 3]]), keys).join("&");
  }
}
function summarize(xs) {
    return __tally(xs, 100);
}
const r = new Report([1, 2, 3]);
console.log(r.total, r.columns(["a", "c", "z"]), summarize([5, 5]));
