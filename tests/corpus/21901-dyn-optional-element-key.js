// Optional element reads on an untyped value: a nullish receiver short-circuits
// before the key is evaluated; a dynamic key is converted to a property key.
function id(v) { return v; }
const log = (m, v) => { console.log(m); return v; };
const u = id(undefined);
const n = id(null);
const o = id({ a: { b: 3 }, arr: [10, 20] });
const k = id("a");
const num = id(1);
console.log(u?.[log("key-u", "a")]);
console.log(n?.[log("key-n", "a")]);
console.log(o?.[log("key-o", "a")]);
console.log(o?.[k]?.b, o?.arr?.[num], o?.[id("zz")]?.q);
console.log(o?.[id("zz")]?.[log("key-z", 0)]);
