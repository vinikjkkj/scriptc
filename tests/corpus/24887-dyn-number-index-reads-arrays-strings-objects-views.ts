// d[i] on a dyn value with a NUMBER index: plain arrays (in range, holes, negative, fractional, NaN, -0, past the end, huge),
// strings, objects with numeric-looking keys, typed arrays, null and undefined receivers (plain and optional), frozen arrays,
// and a typed number[] that crossed into dyn (a live view). `at` has untyped parameters, so
// every read is a dyn read with a number index.
function at(d: any, i: number): any { return d[i]; }
function atOpt(d: any, i: number): any { return d?.[i]; }
const plain: any = [10, "two", { three: 3 }, [4], null, undefined, true];
const holes: any = [1, , 3];
const extra: any = [7, 8];
const frozen: any = Object.freeze([5, 6, 7]);
const objn: any = { 0: "zero", 1: "one", "2": "two", "-1": "neg", "1.5": "frac", 10: "ten", "01": "oh-one", "1e+21": "big", "4294967295": "u32max", "4294967296": "u32over", "NaN": "nan", "Infinity": "inf", "-Infinity": "ninf", "-0": "negzero" };
const u8 = new Uint8Array([9, 8, 7]);
const buf = Buffer.from([1, 2, 3]);
const idx: number[] = [0, 1, 2, 3, 6, 7, -1, -0, 0.5, 1.5, 2.0, NaN, Infinity, -Infinity, 4294967295, 4294967296, 1e21, 10, 2147483647, 9007199254740992, 1e-7, 123456789012345680000, -5, 0.1 + 0.2];
const rnames: string[] = ["plain", "holes", "extra", "frozen", "str", "empty", "objn", "u8", "buf", "num", "bool", "fn"];
function recv(k: number): any {
  switch (k) {
    case 0: return plain;
    case 1: return holes;
    case 2: return extra;
    case 3: return frozen;
    case 4: return "héllo";
    case 5: return "";
    case 6: return objn;
    case 7: return u8;
    case 8: return buf;
    case 9: return 5;
    case 10: return true;
    default: return function f(): void {};
  }
}
function show(v: any): string {
  if (v === undefined) return "u";
  if (v === null) return "n";
  if (typeof v === "object") return Array.isArray(v) ? "[" + v.join(",") + "]" : "{" + Object.keys(v).join(",") + "}";
  if (typeof v === "string") {
    let o = "s";
    for (let q = 0; q < v.length; q++) o += v.charCodeAt(q).toString(16) + ".";
    return o;
  }
  return String(v);
}
for (let ri = 0; ri < rnames.length; ri++) {
  const name = rnames[ri];
  const r = recv(ri);
  let line = name + ":";
  for (const i of idx) line += " " + show(at(r, i)) + "/" + show(atOpt(r, i));
  console.log(line);
}
for (const nm of ["undefined", "null"]) {
  const r = nm === "undefined" ? undefined : null;
  let m: string;
  try { at(r, 3); m = "no throw"; } catch (e: any) { m = e instanceof TypeError ? e.message : "other"; }
  console.log(nm, m, show(atOpt(r, 3)));
}
// a typed number[] crossing into dyn is a live view: a write on either side is seen by the next indexed read
const nums: number[] = [1, 2, 3];
function viewAt(d: any, i: number): any { return d[i]; }
console.log(viewAt(nums, 0), viewAt(nums, 2), viewAt(nums, 3));
nums.push(4);
nums[0] = 99;
console.log(viewAt(nums, 0), viewAt(nums, 3), viewAt(nums, 4));
// a hot loop over a dyn array, a growing one, and a megamorphic receiver mix
const big: number[] = [];
for (let k = 0; k < 2000; k++) big.push(k * 2);
let sum = 0;
for (let k = 0; k < 2000; k++) sum += at(big, k);
console.log(sum);
function mix(k: number): any { return k === 0 ? plain : k === 1 ? "abc" : k === 2 ? objn : k === 3 ? u8 : big; }
let acc = "";
for (let k = 0; k < 40; k++) acc += show(at(mix(k % 5), k % 4));
console.log(acc);
