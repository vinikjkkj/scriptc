"use strict";
// parseInt / parseFloat run ToString over their argument: an untyped number (pg: parseInt(val("port", config), 10) with port: 5432) is no TypeError.
function f(v) { return parseInt(v, 10); }
function g(v) { return parseFloat(v); }
console.log(f("12"), f(1), f(5432), f(1.5), f("0x1f"), f(undefined), f(null), f(true), f([7, 8]), f({ toString() { return "42" } }));
console.log(g("3.5"), g(2), g(null), g("x"));
