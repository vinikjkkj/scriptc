"use strict";
// A "use strict" CommonJS file throws like a module.
function anyv(x) { return x; }
const mk = (n = 0) => class W { m() { return n; } };
const h = {}; h.W = mk(1);
const W = anyv(h.W);
const k = ["proto", "type"].join("");
const key = k === "prototype" ? k : "prototype";
try { W[key] = 1; console.log("no throw"); } catch (e) { console.log(e.name + ": " + e.message); }
