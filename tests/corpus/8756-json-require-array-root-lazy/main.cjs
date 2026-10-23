function f() { return require("./a.json"); }
console.log(f());
const g = () => require("./b.json");
console.log(g());
const o = { t: () => require("./a.json") };
console.log(o.t());
const p = { t: function () { return require("./a.json"); } };
console.log(p.t());
const defs = {
  one: { type: "x", table: function () { return require("./a.json") } },
  two: { type: "y", table: function () { return require("./a.json").concat(require("./b.json")) }, extra: function () { return require("./b.json") } },
};
console.log(defs.one.table(), defs.two.table(), defs.two.extra(), defs.one.type);
const sc = { one: 1, v: require("./s.json"), n: require("./n.json") };
console.log(sc.v, sc.n, require("./b.json").length);
