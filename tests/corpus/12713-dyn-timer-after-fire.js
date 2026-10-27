// After a timer has fired, its untyped handle is still the same object and still a handle with members.
function dyn(x) { return x; }
let fired = null;
const t = setTimeout(() => { fired = t; console.log("fired"); }, 1);
const any = dyn(t);
setTimeout(() => {
  console.log("after fire typeof", typeof any, typeof any.unref);
  console.log("same object", fired === any);
}, 20);
const fresh = setTimeout(() => {}, 1000);
console.log("fresh hasRef", dyn(fresh).hasRef());
clearTimeout(fresh);
