// Array and Map variables initialised from literals over any-typed values.
const n: any = 5;
const s: any = "two";
const o: any = { three: 3 };
const arr = [n, s, o];
console.log(arr, arr.length, arr[1]);
arr.push("four");
console.log(arr);
const m = new Map([["k", n], ["j", s]]);
console.log(m, m.size, m.get("k"), m.has("j"));
m.set("o", o);
console.log(m);
for (const [k, v] of m) console.log(k, v);
