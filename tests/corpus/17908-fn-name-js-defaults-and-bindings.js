// Default parameters, destructuring defaults, bind and logical assignment
// in a JavaScript file.
const util = require("node:util");
function show(label, v) {
  console.log(label, "name=" + JSON.stringify(v.name));
  console.log(v);
  console.log(util.inspect(v));
}
let f;
f = () => 1;
show("assign-ident", f);
const o = {};
o.p = () => 2;
show("member-assign", o.p);
function dp(cb = () => 3) { return cb; }
show("default-param", dp());
const { dd = () => 4 } = {};
show("destr-default", dd);
const [ad = () => 5] = [];
show("array-destr-default", ad);
const f1 = () => 6;
const bf = f1.bind(null);
show("bound", bf);
const bb = bf.bind(null);
show("bound-bound", bb);
let lo = null;
lo ||= () => 8;
show("logical-or-assign", lo);
