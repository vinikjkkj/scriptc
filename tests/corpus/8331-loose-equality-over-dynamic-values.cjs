const v = JSON.parse('{"n":5,"z":0,"s":"5","e":"","t":true,"f":false,"u":null,"nan":"x","arr":[5],"arr0":[],"o":{"k":1},"o2":{"k":1}}');
const row = (name, ...xs) => console.log(name, xs.join(" "));
row("num", v.n == 5, v.n == "5", v.n == "5.0", v.n == " 5 ", v.n == v.s, v.n != v.s, v.n == 6, v.nan == 0);
row("empty", v.z == v.e, v.e == false, v.z == false, v.e == 0, v.e == v.f);
row("bool", v.t == 1, v.t == "1", v.t == true, v.f == 0, v.f == "", v.t == v.n, v.t == "true");
row("nullish", v.u == null, v.u == undefined, v.q == null, v.u == 0, v.u == "", v.u == false, v.u == v.q, v.u != v.q);
row("obj", v.o == v.o, v.o == v.o2, v.o != v.o2, v.o == "[object Object]", v.arr == 5, v.arr == "5", v.arr0 == 0, v.arr0 == "", v.arr == v.arr);
function eq(a, b) { return a == b; }
function ne(a, b) { return a != b; }
const box = { valueOf() { return 7; } };
const boxs = { toString() { return "9"; } };
row("proto", eq(box, 7), eq(7, box), eq(box, "7"), eq(boxs, "9"), eq(boxs, 9), eq(box, boxs), ne(box, 8));
const thrower = { valueOf() { throw new Error("boom"); } };
try { eq(thrower, 1); } catch (e) { row("throw", e.message); }
try { eq(1, thrower); } catch (e) { row("throw2", e.message); }
const big = BigInt(10);
row("big", eq(big, 10), eq(big, "10"), eq(big, 10.5), eq(big, " 0xa "), eq(big, "ten"), eq(1n, true), eq(big, big), eq(big, 1n), eq(0n, ""), eq(0n, false), eq(big, NaN));
function same(a, b) { return [a == b, a != b, a === b].join(","); }
console.log(same(1, "1"), same(null, undefined), same(NaN, NaN), same("a", "a"), same(0, -0), same([], ""), same({}, {}));
