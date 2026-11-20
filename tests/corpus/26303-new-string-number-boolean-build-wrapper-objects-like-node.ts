// new String / new Number / new Boolean build wrapper objects, typed through the lib interfaces.
const s = new String("abc");
const n = new Number(5);
const b = new Boolean(false);
console.log(typeof s, typeof n, typeof b, s.length, n.valueOf() + 1, b ? "t" : "f", s instanceof String, n instanceof Number, b instanceof Boolean);
console.log(String(s), Number(n), Boolean(b), s + "!", `${s}`, s == "abc", s === "abc", JSON.stringify([s, n, b]));
console.log(s, n, b, Object.prototype.toString.call(s), s.charAt(1), s.toUpperCase(), n.toFixed(2), b.toString());
console.log(s[0], Object.keys(s), s.valueOf() === "abc", new String("x") === new String("x"), new String("x") == "x");
const slot: String = new String("hi");
const nums: Number[] = [new Number(1), new Number(2)];
console.log(slot.length, nums.map((x) => x.valueOf() * 2), typeof slot, typeof nums[0]);
function take(v: String | Number | Boolean) { return typeof v + ":" + v.valueOf(); }
console.log(take(new String("q")), take(new Number(7)), take(new Boolean(true)));
console.log(new Number(), new String(), new Boolean(), new String(12), new Number("0x10"), new Boolean("false"), new Boolean(0));
console.log(typeof "abc", typeof String("abc"), typeof 5, "abc".length, (5).toFixed(1));
const prims: string = "plain";
console.log(prims.toUpperCase(), prims === "plain");
let w = new Number(3);
console.log(w.valueOf() + new Number(4).valueOf(), w < new Number(4), Number(w) + 1, (w as any) * 2);
const sym = Symbol("x");
try { console.log(new String(sym as any)); } catch (e: any) { console.log(e.name, e.message); }
try { console.log(new Number(sym as any)); } catch (e: any) { console.log(e.name, e.message); }
console.log(new Boolean(sym as any), String(sym));
const u: unknown = 5n;
console.log(new Number(u as any), new String(u as any), new Boolean(u as any));
console.log(new Number(null as any), new Number(undefined as any), new String(null as any), new String(undefined as any), new Boolean(null as any));
console.log(new String({ toString() { return "obj"; } } as any), new Number([] as any), new Number([5] as any), new String([1, 2] as any));
