// The three V8 property refusals that `Object.defineProperty` can arm name
// the RECEIVER, and they name it from its CONSTRUCTOR -- not from a fixed
// word. Node v25.9.0 is the oracle for every line below:
//
//     {}                   ... of object '#<Object>'
//     new F()              ... of object '#<F>'
//     Object.create(null)  ... of object '[object Object]'
//
// Before this fixture all three texts said `#<Object>` unconditionally, so
// an object that util.inspect ALREADY printed as `F { x: 1 }` refused as
// `#<Object>` -- the same node disagreeing with itself about what it is,
// and a wrong value in a message a program can catch and print. The
// constructor name is `cname`, the field inspect's prefix already reads;
// the null-prototype dictionary has no constructor at all and V8 falls
// back to the ToString form, which is the `null_proto` flag exactly.
//
// The three texts, and what arms each:
//
//   1. `{ value }` alone defaults writable to FALSE, so a later write is
//      "Cannot assign to read only property 'k' of object '<recv>'".
//   2. `{ value }` alone defaults configurable to FALSE, so a later delete
//      is "Cannot delete property 'k' of <recv>".
//   3. A getter with no setter refuses a write with
//      "Cannot set property k of <recv> which has only a getter".
//
// A JavaScript entry on purpose, the way 2765 is: in TypeScript the
// checker rejects the write and the delete outright (SC0001 / TS2540)
// before any of this can run, so the whole family is JS-gated. The
// property writes go through `put`/`del` helpers with implicit-any
// parameters for the same reason -- tsc's checkJs infers `readonly` from
// the descriptor literal at a direct `o.p = v`.

"use strict";

function put(o, k, v) { o[k] = v; }
function del(o, k) { return delete o[k]; }

function T(label, f) {
  try {
    f();
    console.log(label + " NOTHREW");
  } catch (e) {
    console.log(label + " " + e.name + ": " + e.message);
  }
}

function F() { this.x = 1; }
function Weird$Name() { this.x = 1; }
var Anon = function () { this.x = 1; };

// ---------------------------------------------------------------- 1. write
var w1 = {};
Object.defineProperty(w1, "p", { value: 1 });
T("write.plain", function () { put(w1, "p", 2); });

var w2 = new F();
Object.defineProperty(w2, "p", { value: 1 });
T("write.instance", function () { put(w2, "p", 2); });

var w3 = Object.create(null);
Object.defineProperty(w3, "p", { value: 1 });
T("write.nullproto", function () { put(w3, "p", 2); });

var w4 = new Weird$Name();
Object.defineProperty(w4, "p", { value: 1 });
T("write.weird", function () { put(w4, "p", 2); });

var w5 = new Anon();
Object.defineProperty(w5, "p", { value: 1 });
T("write.anon", function () { put(w5, "p", 2); });

// An INHERITED read-only data property refuses too, and names the object
// the write started from -- not the prototype the property was found on.
function P() { this.y = 1; }
Object.defineProperty(P.prototype, "s", { value: 1, writable: false });
var w6 = new P();
T("write.inherited", function () { put(w6, "s", 2); });

// ---------------------------------------------------------------- 2. delete
var d1 = {};
Object.defineProperty(d1, "p", { value: 1 });
T("delete.plain", function () { del(d1, "p"); });

var d2 = new F();
Object.defineProperty(d2, "p", { value: 1 });
T("delete.instance", function () { del(d2, "p"); });

var d3 = Object.create(null);
Object.defineProperty(d3, "p", { value: 1 });
T("delete.nullproto", function () { del(d3, "p"); });

var d4 = new Weird$Name();
Object.defineProperty(d4, "p", { value: 1 });
T("delete.weird", function () { del(d4, "p"); });

// `configurable: true` deletes cleanly, and the key really goes.
var d5 = new F();
Object.defineProperty(d5, "p", { value: 1, configurable: true });
console.log("delete.configurable " + JSON.stringify([del(d5, "p"), "p" in d5]));

// ---------------------------------------------- 3. getter-only assignment
var g1 = {};
Object.defineProperty(g1, "q", { get: function () { return 1; } });
T("getter.plain", function () { put(g1, "q", 2); });

var g2 = new F();
Object.defineProperty(g2, "q", { get: function () { return 1; } });
T("getter.ownInstance", function () { put(g2, "q", 2); });

// Found on the PROTOTYPE, written through an instance: JS binds the
// refusal to the instance, so the name has to come off the receiver.
Object.defineProperty(F.prototype, "r", { get: function () { return 1; } });
var g3 = new F();
T("getter.protoInstance", function () { put(g3, "r", 2); });

var g4 = Object.create(null);
Object.defineProperty(g4, "q", { get: function () { return 1; } });
T("getter.nullproto", function () { put(g4, "q", 2); });

// A getter WITH a setter takes the write, and it runs with `this` bound to
// the instance -- the control case for the three refusals above.
Object.defineProperty(F.prototype, "acc", {
  get: function () { return this.x; },
  set: function (n) { this.x = n * 10; }
});
var g5 = new F();
put(g5, "acc", 4);
console.log("getter.withSetter " + JSON.stringify([g5.x, g5.acc, Object.keys(g5)]));

// ------------------------------------------------------ 4. the same name
// inspect's prefix and the refusal text read the SAME field, so a program
// cannot see them disagree.
console.log("agree.instance " + JSON.stringify(inspectName(w2)));
console.log("agree.plain " + JSON.stringify(inspectName(w1)));

function inspectName(o) {
  var s = "";
  try {
    put(o, "p", 2);
  } catch (e) {
    s = e.message;
  }
  return s;
}
