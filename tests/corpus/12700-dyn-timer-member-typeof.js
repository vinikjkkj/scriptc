// A timer handle held in an untyped slot: each member reads as a function.
function probe(h, label) {
  console.log(label, typeof h, typeof h.ref, typeof h.unref, typeof h.hasRef, typeof h.refresh, typeof h.close);
}
const t = setTimeout(() => console.log("fired"), 1);
probe(t, "timeout");
const i = setImmediate(() => console.log("immediate fired"));
probe(i, "immediate");
clearTimeout(t);
clearImmediate(i);
