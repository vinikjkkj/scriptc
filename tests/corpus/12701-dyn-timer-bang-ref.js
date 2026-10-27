// `!h.ref` must answer "not missing": a function is truthy, so the negation is false.
function feature(h) {
  if (!h.ref) return "no ref member";
  if (!h.unref) return "no unref member";
  return "has members";
}
function truth(h) {
  return [!h.refresh, !!h.unref, h.ref ? "truthy" : "falsy"].join(" ");
}
const t = setTimeout(() => {}, 1000);
console.log(feature(t));
console.log(truth(t));
const u = { handle: setTimeout(() => {}, 1000) };
const dyn = u.handle;
console.log(feature(dyn));
clearTimeout(dyn);
clearTimeout(t);
const im = setImmediate(() => {});
console.log(feature(im), truth(im));
clearImmediate(im);
