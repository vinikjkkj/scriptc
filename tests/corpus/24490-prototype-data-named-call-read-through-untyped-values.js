// Prototype data named `call` (a Function.prototype member name) on an ES class, read through untyped values: the answer is the instance's own
// field when it has one, else the prototype's value for an instance of the class, else undefined -- Node's lookup.
class Commander {
  constructor() { this.tag = "c"; }
}
Commander.prototype.call = "proto-call";
class Sub extends Commander {}
function read(e) { return e.call; }
function present(e) { return null != e.call && Object.hasOwnProperty.call(e, "call"); }
console.log(read({ call: 1 }), read({}), read(new Commander()), read(new Sub()));
console.log(present({ call: 1 }), present({}));
const own = new Commander();
own.call = "own-call";
console.log(read(own), read(new Commander()), own.call);
