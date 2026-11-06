// A class writes prototype data under a name the program can also store an own undefined to: that write is refused (the datum is fenced). A read of the
// same name through an untyped value is the ordinary one for the receivers that are not instances of that class and adds no refusal of its own.
class Commander {}
Commander.prototype.call = "dflt";
function mk(o, v) { o.call = v; }
function enc(e) { return null != e.call ? "has" : "no"; }
mk({}, undefined);
console.log(enc({ call: 1 }), enc({}));
