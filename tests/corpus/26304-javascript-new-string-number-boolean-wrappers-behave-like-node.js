// JavaScript: the primitive wrappers built with new keep object identity, truthiness, ToPrimitive in operators and own properties.
var s = new String("abc"), n = new Number(5), b = new Boolean(false);
console.log(typeof s, typeof n, typeof b, s.length, n + 1, b ? "truthy" : "falsy", !!b, s instanceof String);
if (b) console.log("wrapper is truthy"); else console.log("no");
console.log(s + "!", n * 2, s == "abc", s === "abc", n == 5, n === 5, b == false, JSON.stringify({ s: s, n: n, b: b }));
var box = { v: new String("in") };
console.log(box, box.v.length, [new Number(1), new Number(2)].map(function (x) { return x + 1; }));
function isStr(v) { return typeof v === "string" || v instanceof String; }
console.log(isStr("a"), isStr(new String("a")), isStr(1), Object.prototype.toString.call(new Boolean(true)));
var o = new String("hi"); o.extra = 1;
console.log(o.extra, Object.keys(o), o.toString(), String(o), o.valueOf());
console.log(new String("a") + new String("b"), new Number(2) + new Number(3), `${new Number(9)}`, [new String("z")].join());
console.log(String(new Boolean(true)), Number(new String("12")), new Number(NaN), -new Number(3), +new String("4"));
switch (n.valueOf()) { case 5: console.log("five"); }
console.log(new String("abc").split("").length, new String("Ab").toLowerCase(), new Number(255).toString(16), new Boolean(true).valueOf());
