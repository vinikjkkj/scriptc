// clearTimeout and clearInterval accept an untyped handle and cancel it.
function dyn(x) { return x; }
const t = setTimeout(() => console.log("must not fire"), 10);
const i = setInterval(() => console.log("must not tick"), 10);
clearTimeout(dyn(t));
clearInterval(dyn(i));
setTimeout(() => console.log("survivor"), 30);
