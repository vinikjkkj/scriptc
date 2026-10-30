// A function-local evolving array returned to the caller.
function make() {
  const out = [];
  out.push("q");
  out.push("r");
  return out;
}
const r = make();
console.log(r, r.length, r.join("+"));
