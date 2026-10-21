// toLocaleString on checked-dynamic receivers: a number groups and rounds like Intl.NumberFormat("en-US"), an
// array joins its elements' toLocaleString with commas (null and undefined are empty, a Date answers its formatter),
// at the default locale or an explicit en-US / en and no options.
const n: any = 1234567.891;
console.log(n.toLocaleString(), n.toLocaleString("en-US"), n.toLocaleString("en"), n.toLocaleString(undefined));
const z: any = -0;
const nan: any = NaN, inf: any = Infinity, huge: any = 1e21;
console.log(z.toLocaleString(), nan.toLocaleString(), inf.toLocaleString(), huge.toLocaleString());
const t1: any = 0.0005, t2: any = -1234.5678, t3: any = 12;
console.log(t1.toLocaleString(), t2.toLocaleString(), t3.toLocaleString());
const a: any = [1, 2.5, "x", null, undefined, true, [1000, [2000000]], 12345.6789];
console.log(a.toLocaleString());
console.log(a.toLocaleString("en-US"));
const e: any = [];
console.log(JSON.stringify(e.toLocaleString()));
const withDate: any = [new Date(86400000), 5000];
console.log(withDate.toLocaleString());
const s: any = "text";
const tr: any = true;
console.log(s.toLocaleString(), tr.toLocaleString());
const o: any = { toString() { return "custom"; } };
console.log(o.toLocaleString());
const big: any = [123456789012345678901234567890n, -1000n];
console.log(big.toLocaleString());
