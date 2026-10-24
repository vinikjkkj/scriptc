// An array an untyped container or closure KEEPS is still the caller's
// array: a push or an element write made afterwards is visible through the
// kept reference, and a write through the kept reference reaches the
// caller's binding. Reads of the kept value answer from the array itself.
'use strict';

const keep = [];
function hold(a) { keep.push(a); }
function put(m, k, v) { m.set(k, v); }

function viaClosureList() {
  const xs = [1, 2, 3];
  hold(xs);
  xs.push(4);
  xs[0] = 10;
  console.log(keep[0].length, keep[0][0], keep[0].join(","), JSON.stringify(keep[0]));
  keep[0].push(5);
  keep[0][1] = 20;
  console.log(xs.length, xs.join(","));
  for (const v of keep[0]) console.log(v);
  console.log([...keep[0]].length, keep[0].map((x) => x * 2).join(","));
}
viaClosureList();

function viaUntypedMap() {
  const m = new Map();
  m.set(1, "one");
  m.set("two", 2);
  const xs = [1, 2];
  put(m, "xs", xs);
  xs.push(3);
  console.log(m.get("xs").length);
  m.get("xs").push(4);
  console.log(xs.length, xs.join(","));
  xs[0] = 99;
  console.log(m.get("xs")[0], m.get("xs").join("-"));
  m.get("xs").sort((a, b) => b - a);
  console.log(xs.join(","));
}
viaUntypedMap();

function viaSet() {
  const s = new Set();
  s.add("a");
  s.add(1);
  const ws = ["p", "q"];
  s.add(ws);
  ws.push("r");
  for (const v of s) if (Array.isArray(v)) console.log(v.length, v.join(""), s.has(ws));
}
viaSet();
