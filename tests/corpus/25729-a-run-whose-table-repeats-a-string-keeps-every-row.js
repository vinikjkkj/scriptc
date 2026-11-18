// Statements that differ only in string literals, where the same literal repeats across rows: the run becomes a loop over a table with repeated entries.
'use strict';
var M = {
  tag(a, b) { return a + ":" + b; },
};
var out = [];
out.push(M.tag("type", "_sbcs") + M.tag("kind", "x1")), out.push(M.tag("type", "_sbcs") + M.tag("kind", "x2")), out.push(M.tag("type", "_dbcs") + M.tag("kind", "x1"));
out.push(M.tag("type", "_sbcs") + M.tag("kind", "x3"));
console.log(out.join("|"));
var tbl = {};
tbl["a"] = M.tag("t", "_sbcs"); tbl["b"] = M.tag("t", "_sbcs"); tbl["c"] = M.tag("t", "_dbcs"); tbl["d"] = M.tag("t", "_sbcs");
console.log(Object.keys(tbl).join(","), tbl.a, tbl.c, tbl.d);
