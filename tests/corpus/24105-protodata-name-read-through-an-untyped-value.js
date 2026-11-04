"use strict";
// A name some class writes as prototype data (`Commander.prototype.call`, `.note`) read through an UNTYPED receiver: a plain message
// object, an instance whose own field is unset (the prototype's value answers), an instance that set the field itself (the own value),
// an instance of a subclass, and an unrelated class instance.
function gen(name) { return function () { return name + ":" + this.tag; }; }
class Commander { constructor(tag) { this.tag = tag; } }
Commander.prototype.call = gen("call");
Commander.prototype.note = "proto-note";
class Redis extends Commander { constructor() { super("redis"); } }
class Unrelated { constructor() { this.call = "own-call"; } }
function kind(v) { return typeof v; }
function viaCall(x) { return x.call; }
function viaNote(x) { return x.note; }
const plain = JSON.parse('{"call":"x","note":"n"}');
const empty = JSON.parse("{}");
const c1 = new Commander("c1");
const c2 = new Commander("c2");
c2.note = "own-note";
const r = new Redis();
const u = new Unrelated();
console.log(kind(viaCall(plain)), viaCall(plain), viaNote(plain));
console.log(kind(viaCall(empty)), viaNote(empty));
console.log(kind(viaCall(c1)), viaNote(c1), viaNote(c2));
console.log(kind(viaCall(r)), viaNote(r), viaCall(c1).call(c1));
console.log(viaCall(u), viaNote(u));
Commander.prototype.note = "changed";
console.log(viaNote(c1), viaNote(c2), viaNote(r));
