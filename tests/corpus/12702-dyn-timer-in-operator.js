// `in` over a dyn timer handle answers the declared members, and nothing else.
function has(h, k) { return k in h; }
const t = setTimeout(() => console.log("fired"), 1000);
const i = setImmediate(() => console.log("immediate fired"));
for (const k of ["ref", "unref", "hasRef", "refresh", "close", "nope"]) {
  console.log("timeout", k, has(t, k));
}
for (const k of ["ref", "unref", "hasRef", "refresh", "close", "nope"]) {
  console.log("immediate", k, has(i, k));
}
clearTimeout(t);
clearImmediate(i);
