// refresh() through an untyped handle re-arms the same timer.
function dyn(x) { return x; }
let fires = 0;
const t = setTimeout(() => { fires++; console.log("fire", fires); }, 15);
const h = dyn(t);
setTimeout(() => {
  h.refresh();
  console.log("refreshed, hasRef", h.hasRef());
}, 5);
setTimeout(() => console.log("done, fires so far", fires), 200);
