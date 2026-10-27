// Two untyped boxes of one handle are the same handle; distinct timers are not.
function dyn(x) { return x; }
const t = setTimeout(() => {}, 1000);
const u = setTimeout(() => {}, 1000);
const a = dyn(t);
const b = dyn(t);
const c = dyn(u);
console.log("same", a === b, a === c, a.hasRef() === b.hasRef());
console.log("typeof object", typeof a === "object", !!a);
clearTimeout(t);
clearTimeout(u);
