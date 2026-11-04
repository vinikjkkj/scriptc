// A `new Function` over text assembled from run-time data runs on the embedded engine, in a program that also uses native regular
// expressions: both link the engine archive's libregexp, so the host hooks (stack check, timeout, allocation) have one owner.
const cols = ["x0", "x1", "x2"];
const lines = [];
for (let i = 0; i < cols.length; i++) lines.push("  " + cols[i] + " = a * " + (i + 1) + ";");
const src = "let " + cols.join(", ") + " = 0;\n" + lines.join("\n") + "\n  return x0 + x1 + x2;";
const f = new Function("a", src);
console.log(f(2), f(5));
// native regex before, between and after engine calls
const date = /(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})/u;
const m = date.exec("on 2026-11-04 we ship");
if (m !== null) console.log(m.index, m[1], m[2], m[3]);
console.log("a1b22c333".replace(/\d+/g, (x) => "<" + x.length + ">"), "x,y;z".split(/[,;]/));
console.log(f(7), /^[\p{L}]+$/u.test("héllo"), /^[\p{L}]+$/u.test("he llo"));
const sticky = /ab/y;
sticky.lastIndex = 2;
console.log(sticky.test("xxabab"), sticky.lastIndex, [..."a-b-c".matchAll(/-/g)].length);
// a regex inside the engine's own text runs on the engine's regex, with the same answers
const g = new Function("s", "return [s.replace(/o+/g, '0'), /^\\d{2}$/.test(s), s.split(/l/).length];");
console.log(g("hello wooorld"), g("42"));
console.log(f(1) + f(2), typeof g);
