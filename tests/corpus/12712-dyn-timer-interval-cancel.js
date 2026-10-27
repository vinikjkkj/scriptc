// setInterval held untyped: clearInterval through the untyped handle stops the ticks, and its members read as functions.
function dyn(x) { return x; }
let ticks = 0;
const iv = setInterval(() => { ticks++; console.log("tick", ticks); if (ticks === 2) clearInterval(dyn(iv)); }, 5);
const any = dyn(iv);
console.log("interval hasRef", any.hasRef(), typeof any.unref);
