// The same naming positions as the TypeScript rows, in a JavaScript file.
const util = require("node:util");
function show(label, v) {
  console.log(label, "name=" + JSON.stringify(v.name));
  console.log(v);
  console.log(util.inspect(v));
}
class C {
  fld = () => "F";
  static sfld = function () { return 1; };
  toString2 = () => "G";
  get gx() { return 1; }
  set gx(v) {}
  m() { return 2; }
  static sm() { return 3; }
}
class K { }
const KE = class { };
const c = new C();
show("C.fld", c.fld);
show("C.sfld", C.sfld);
show("C.toString2", c.toString2);
show("C.sm", C.sm);
show("class K", K);
show("KE", KE);
show("object-class-prop", { c: class {} }.c);
