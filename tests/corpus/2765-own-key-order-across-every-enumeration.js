// JS own-key ORDER, and the rule that every enumeration must answer the
// same one.
//
// OrdinaryOwnPropertyKeys (ECMA-262 10.1.11.1) is NOT insertion order:
//
//   1. the ARRAY-INDEX keys first, ascending by numeric value,
//   2. then every other string key, in insertion order,
//   3. then symbols.
//
// "Array index" is the spec's narrow test, not "looks numeric": a
// canonical decimal string, no leading zero, strictly BELOW 2^32-1. So
// "0" and "4294967294" sort ahead, while "4294967295" — the boundary
// itself — "01", "-1", "1.5" and "4294967296" are ordinary string keys
// that hold their insertion slot. Node v25.9.0 is the oracle for every
// line below, byte for byte.
//
// This runtime used to know the rule in exactly one place. Object.keys /
// values / entries walked the projection; JSON.stringify, util.format's
// %j and util.inspect walked the entry table raw. So three enumerations
// disagreed with the fourth about the SAME object inside the SAME
// process, silently, and the shape they disagreed on is the one
// protobufjs builds every enum reverse-lookup table out of:
//
//     var e = {}; e[0] = "E2EE"; e[1] = "HOSTED";
//     Object.keys(e)     // 0,1        <- right
//     JSON.stringify(e)  // {"0":…,"1":…} only because 0 and 1 happened
//                        //    to be inserted in ascending order already
//
// Insert them in any other order and the two answers part company.

import { format, inspect } from "node:util";

function show(label, a, b) { if (b === undefined) console.log(label, a); else console.log(label, a, b); }

// ── 1. the canonical disagreement ────────────────────────────────────
// String keys first, then index keys — so insertion order and JS order
// differ in every position.
var o = {};
o["z"] = 1;
o["a"] = 2;
o[10] = 3;
o[2] = 4;

show("keys      ", Object.keys(o).join(","));
show("values    ", Object.values(o).join(","));
show("entries   ", JSON.stringify(Object.entries(o)));
show("stringify ", JSON.stringify(o));
show("inspect   ", o);
show("indent    ", JSON.stringify(o, null, 2).replace(/\n/g, "|"));
show("gopn      ", Object.getOwnPropertyNames(o).join(","));
show("assignKeys", Object.keys(Object.assign({}, o)).join(","));
show("assignJson", JSON.stringify(Object.assign({}, o)));
show("spreadKeys", Object.keys({ ...o }).join(","));
show("spreadJson", JSON.stringify({ ...o }));
show("cloneKeys ", Object.keys(structuredClone(o)).join(","));
show("cloneJson ", JSON.stringify(structuredClone(o)));
show("fmt-j     ", format("%j", o));
show("fmt-o     ", format("%o", o));
show("inspect() ", inspect(o));

// ── 2. the boundary, in one object ───────────────────────────────────
// Inserted deliberately worst-first: the two keys that LOOK like the
// largest indices go in before the two that are real ones.
var b = {};
b["4294967295"] = "boundary-not-an-index";
b["4294967294"] = "largest-real-index";
b["a"] = "plain";
b["0"] = "zero";
b["-1"] = "negative";
b["1.5"] = "fractional";
b["01"] = "leading-zero";
b["4294967296"] = "past-uint32";

show("bkeys     ", Object.keys(b).join("|"));
show("bjson     ", JSON.stringify(b));
show("binspect  ", b);
show("bfmtj     ", format("%j", b));

// The same key written as a NUMBER and as a STRING is the same property.
var n = {};
n[0] = "written-as-number";
n["0"] = "written-as-string";
show("numstr    ", Object.keys(n).join(","), JSON.stringify(n));

// ── 3. mixed, nested, and inside arrays ──────────────────────────────
var nest = {};
nest["w"] = 9;
nest["inner"] = o;
nest[5] = 8;
nest["deep"] = { list: [o, b["0"]] };

show("nestjson  ", JSON.stringify(nest));
show("nestinsp  ", nest);
show("arrjson   ", JSON.stringify([o]));
show("arrinsp   ", [o]);

// ── 4. a null-prototype dictionary takes the same order ──────────────
var d = Object.create(null);
d["z"] = 1;
d[7] = 2;
d["a"] = 3;
d[3] = 4;
show("dkeys     ", Object.keys(d).join(","));
show("djson     ", JSON.stringify(d));
show("dinsp     ", d);

// ── 5. ordering is a property of the OBJECT, not of when it was read ──
// A key added after the first read re-sorts into place on the next one.
var g = {};
g["b"] = 1;
show("grow-1    ", Object.keys(g).join(","), JSON.stringify(g));
g[4] = 2;
show("grow-2    ", Object.keys(g).join(","), JSON.stringify(g));
g["a"] = 3;
show("grow-3    ", Object.keys(g).join(","), JSON.stringify(g));
g[0] = 4;
show("grow-4    ", Object.keys(g).join(","), JSON.stringify(g));
// Overwriting an existing key keeps its ORIGINAL slot (JS does not
// re-insert), which is only observable among the string keys.
g["b"] = 99;
show("grow-5    ", Object.keys(g).join(","), JSON.stringify(g));

// ── 6. already-ordered tables must not move ──────────────────────────
// The fast path: a table whose stored order already IS the JS order.
// protobufjs's enum factories build exactly this, ascending.
var enumTable = {};
enumTable[0] = "E2EE";
enumTable[1] = "HOSTED";
enumTable[2] = "FACEBOOK";
show("enum      ", Object.keys(enumTable).join(","), JSON.stringify(enumTable));
show("enuminsp  ", enumTable);

// ...and a table with no index keys at all keeps pure insertion order.
var pure = {};
pure["gamma"] = 3;
pure["alpha"] = 1;
pure["beta"] = 2;
show("pure      ", Object.keys(pure).join(","), JSON.stringify(pure));
show("pureinsp  ", pure);

// ── 7. the protobufjs enum factory, both directions ──────────────────
// The forward table is string-keyed and the reverse table is
// integer-keyed, built in the same comma chain — the shape the two
// enumerations used to disagree about.
var reverse = null;
var Kind = (function () {
  var byId = {}, byName = Object.create(byId);
  reverse = byId;
  return byName[byId[2] = "TWO"] = 2, byName[byId[0] = "ZERO"] = 0, byName;
})();
show("fwd       ", Object.keys(Kind).join(","), JSON.stringify(Kind));
show("rev       ", Object.keys(reverse).join(","), JSON.stringify(reverse));
show("revinsp   ", reverse);
// The reverse table is the child's PROTOTYPE, so none of its keys are
// own keys of the child — the projection is per-object, not per-chain.
show("fwd-has-0 ", Object.hasOwn(Kind, "0"), Object.hasOwn(reverse, "0"));

// A JSON round trip re-sorts, because parse inserts in text order and
// the next stringify projects again.
var round = JSON.parse('{"b":1,"10":2,"a":3,"2":4}');
show("round     ", Object.keys(round).join(","), JSON.stringify(round));

console.log("done");
