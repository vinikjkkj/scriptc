// Array and typed-array sort: O(n log n), stable, comparator contract (NaN/0 hold position), undefined last, inconsistent comparators terminate.
let seed = 12345;
function rnd(): number { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; }
function mkStr(): string { let s = ""; const len = 3 + (rnd() % 6); for (let i = 0; i < len; i++) s += String.fromCharCode(97 + (rnd() % 26)); return s; }

const N = 20000;
const strs: string[] = [];
for (let i = 0; i < N; i++) strs.push(mkStr());
const byCmp = strs.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const byDefault = strs.slice().sort();
let okStr = true;
for (let i = 1; i < N; i++) if (byCmp[i - 1] > byCmp[i]) okStr = false;
let same = true;
for (let i = 0; i < N; i++) if (byCmp[i] !== byDefault[i]) same = false;
console.log("strings", N, okStr, same, byCmp[0], byCmp[N >> 1], byCmp[N - 1]);

const nums: number[] = [];
for (let i = 0; i < 100000; i++) nums.push(rnd() % 1000003);
const sortedNums = nums.slice().sort((a, b) => a - b);
let okNum = true;
for (let i = 1; i < sortedNums.length; i++) if (sortedNums[i - 1] > sortedNums[i]) okNum = false;
console.log("numbers", sortedNums.length, okNum, sortedNums[0], sortedNums[50000], sortedNums[99999]);
const desc = nums.slice().sort((a, b) => b - a);
console.log("desc", desc[0], desc[99999]);

type Rec = { key: number; id: number };
const recs: Rec[] = [];
for (let i = 0; i < 30000; i++) recs.push({ key: rnd() % 50, id: i });
recs.sort((a, b) => a.key - b.key);
let stable = true;
for (let i = 1; i < recs.length; i++) {
  if (recs[i - 1].key > recs[i].key) stable = false;
  if (recs[i - 1].key === recs[i].key && recs[i - 1].id > recs[i].id) stable = false;
}
console.log("objects stable", stable, recs[0].key, recs[0].id, recs[29999].key, recs[29999].id);

// comparator results that are not positive numbers hold position (NaN, 0, negative): all-equal comparator = identity, stable
const ident: number[] = [];
for (let i = 0; i < 50; i++) ident.push(i);
console.log("nan", ident.slice().sort((a, b) => NaN).join(",") === ident.join(","));
console.log("zero", ident.slice().sort((a, b) => 0).join(",") === ident.join(","));
const rev = ident.slice().sort((a, b) => b - a);
console.log("rev", rev[0], rev[49]);

// an inconsistent comparator must terminate and keep every element exactly once
const inc: number[] = [];
for (let i = 0; i < 200; i++) inc.push(i * 7 % 101);
const incSorted = inc.slice().sort((a, b) => ((a * 7 + b * 3) % 5) - 2);
let sumIn = 0, sumOut = 0;
for (let i = 0; i < 200; i++) { sumIn += inc[i]; sumOut += incSorted[i]; }
console.log("inconsistent", incSorted.length, sumIn === sumOut);

// undefined sorts last, never reaches the comparator
const mixed: (number | undefined)[] = [];
for (let i = 0; i < 40; i++) mixed.push(i % 5 === 0 ? undefined : (i * 13) % 17);
let calls = 0;
mixed.sort((a, b) => { calls++; return (a as number) - (b as number); });
let undefAt = -1;
for (let i = 0; i < mixed.length; i++) if (mixed[i] === undefined && undefAt < 0) undefAt = i;
console.log("undefined last", undefAt, mixed.length, mixed[0], mixed[31], calls > 0);

// toSorted leaves the receiver alone
const base = [5, 3, 9, 1, 7, 2, 8, 6, 4, 0, 15, 12, 11, 14, 13, 10];
const ts = base.toSorted((a, b) => a - b);
console.log("toSorted", ts.join(","), base[0], base[15]);

// typed arrays: default order, comparator, toSorted, a subarray writes through
const u8 = new Uint8Array(70000);
for (let i = 0; i < u8.length; i++) u8[i] = rnd() % 256;
u8.sort();
let okU8 = true;
for (let i = 1; i < u8.length; i++) if (u8[i - 1] > u8[i]) okU8 = false;
console.log("u8", okU8, u8[0], u8[35000], u8[69999]);
const f64 = new Float64Array(5000);
for (let i = 0; i < f64.length; i++) f64[i] = (rnd() % 100000) / 7;
f64.sort((a, b) => b - a);
let okF = true;
for (let i = 1; i < f64.length; i++) if (f64[i - 1] < f64[i]) okF = false;
console.log("f64 desc", okF, f64[0], f64[4999]);
const i32 = new Int32Array(40);
for (let i = 0; i < 40; i++) i32[i] = (i * 37) % 23 - 11;
const u8t = new Uint8Array(40);
for (let i = 0; i < 40; i++) u8t[i] = (i * 37) % 23;
const u8s = u8t.toSorted((a, b) => b - a);
console.log("u8 toSorted", Array.from(u8s).join(","), u8t[0]);
i32.sort((a, b) => a - b);
console.log("i32", Array.from(i32).join(","));
const big = new Uint8Array(30);
for (let i = 0; i < 30; i++) big[i] = (i * 29) % 31;
big.subarray(5, 25).sort((a, b) => a - b);
console.log("sub", Array.from(big).join(","));

const many: string[] = [];
for (let i = 0; i < 100000; i++) many.push(mkStr());
many.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
let okMany = true;
for (let i = 1; i < many.length; i++) if (many[i - 1] > many[i]) okMany = false;
console.log("100k strings", okMany, many[0], many[99999]);
