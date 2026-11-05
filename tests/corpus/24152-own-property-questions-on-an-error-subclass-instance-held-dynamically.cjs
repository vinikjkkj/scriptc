// Object.hasOwn / Object.prototype.hasOwnProperty.call over an untyped receiver that holds an instance of an `extends Error`
// class (a driver's DbErr): its own properties are the constructor-assigned fields, `stack`, `message`, an assigned `name`
// and a `cause`; methods, the prototype's name and unknown names are not. Ownership is a FACT, not a value test: an assigned
// name equal to the canonical "Error" is own, a constructor called without a message (or with undefined) installs none, an
// empty message is own, a later assignment makes it own.
class DbErr extends Error {
  constructor(msg, code) {
    super(msg);
    this.code = code;
    this.name = "DbErr";
  }
  describe() { return this.code; }
}
class Caused extends Error {
  constructor(msg) { super(msg, { cause: 7 }); this.extra = 1; }
}
class Canon extends Error {
  constructor() { super("m"); this.name = "Error"; }
}
class Bare extends Error {
  constructor() { super(); }
}
class Empty extends Error {
  constructor() { super(""); }
}
class Undef extends Error {
  constructor() { super(undefined); }
}
class Late extends Error {
  constructor() { super(); this.message = "late"; }
}
class Plain { constructor() { this.a = 1; } m() { return 1; } }
function probe(e) {
  const has = (k) => Object.prototype.hasOwnProperty.call(e, k);
  return [has("stack"), has("message"), has("code"), has("name"), has("cause"), has("nope"), has("a"), has("m"), has("describe"), has("extra"), Object.hasOwn(e, "code")].join(",");
}
console.log(probe(new DbErr("boom", "E1")));
console.log(probe(new Caused("why")));
console.log(probe(new Canon()));
console.log(probe(new Bare()));
console.log(probe(new Empty()));
console.log(probe(new Late()));
console.log(probe(new Undef()));
// The same facts through every spelling of the write: a call result's receiver, an array element, a member chain, an untyped
// keyed write and Object.assign.
function pass(e) { return e; }
const viaCall = new Bare();
pass(viaCall).name = "Error";
console.log(probe(viaCall));
const list = [new Bare(), new Bare()];
list[1].name = "Error";
list[1].message = "set";
console.log(probe(list[0]), probe(list[1]));
const holder = { err: new Bare() };
holder.err.message = "";
console.log(probe(holder.err));
function setKey(o, k, v) { o[k] = v; }
const keyed = new Bare();
setKey(keyed, "name", "Error");
setKey(keyed, "message", "keyed");
console.log(probe(keyed));
function assignTo(o, src) { return Object.assign(o, src); }
const assigned = new Bare();
assignTo(assigned, { name: "Error" });
console.log(probe(assigned));
console.log(probe(new Plain()));
console.log(probe(new Error("x")));
