// Object.entries(anyValue) is typed `[string, any][]` by tsc, which has no static mapping; the walk answers the checked-dynamic array.
// `.length` of it, and `([k, v]) => ...` callbacks over it, read the dyn pairs.
function lengths(b: any) {
  const e = Object.entries(b);
  console.log(e.length, Object.keys(b).length, Object.values(b).length, Object.entries(b).length);
}
lengths({ p: 1, q: 2 });
lengths([5, 6, 7]);
function callbacks(b: any) {
  console.log(Object.entries(b).map(([k, v]) => k + "=" + JSON.stringify(v)));
  Object.entries(b).forEach(([k, v]) => console.log(k, v));
  console.log(Object.entries(b).filter(([, v]) => typeof v === "number").length);
  for (const [k, v] of Object.entries(b)) console.log(k, v);
}
callbacks({ p: 1, q: [2], r: "s" });
function twin(a: any, b: any) {
  const { x, y } = a;
  console.log(x, y, Object.entries(b).length);
}
twin({ x: 1, y: 2 }, { p: 1, q: 2, r: 3 });
