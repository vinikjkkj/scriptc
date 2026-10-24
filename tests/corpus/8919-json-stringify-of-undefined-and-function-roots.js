// JSON.stringify over a checked-dynamic root: Node answers undefined (the
// value, typeof 'undefined') for a root the stringify drops, and the text
// otherwise. Inside an object the member drops; inside an array it is null.
function show(u) {
  const s = JSON.stringify(u);
  console.log(typeof s, s);
}
show(undefined);
show(() => 1);
show(function named() {});
show(null);
show(5);
show("text");
show({ a: undefined, b: 2 });
show([undefined, 2, () => 1]);
show({ nested: { keep: "yes", drop: undefined } });

const vals = [undefined, 3, "s", { a: 1 }, null, () => 2];
for (const v of vals) {
  const s = JSON.stringify(v);
  console.log(typeof s, s);
}

const u = undefined;
const r = JSON.stringify(u);
console.log(typeof r, r === undefined, String(r));

function pretty(v) {
  const p = JSON.stringify(v, null, 2);
  console.log(typeof p, p);
}
pretty(undefined);
pretty({ x: [1, { y: "z" }] });

// A record with an index signature is a non-callable object: its root always
// serializes, so the stringify stays a string for a consumer typed string.
function keyed(name) {
  const key = JSON.stringify({ [name]: 1 }).slice(1, -3);
  console.log(typeof key, key);
}
keyed("a");
keyed("bb");
