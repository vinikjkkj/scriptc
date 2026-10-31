// Symbol-keyed members inside nested records and arrays: each record prints
// its own string keys first, then its symbol keys, at every depth.
const k = Symbol("inner");
const outer = { name: "outer", inner: { v: 1, [k]: "deep" }, list: [{ [k]: 3, n: 4 }] };
console.log(outer);
console.log(JSON.stringify(outer), Object.keys(outer.inner));
