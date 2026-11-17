// Chains over Object.values / Object.entries of an any-member record: map, filter, find, for-of, destructuring, JSON.
const n: any = 5;
const t: any = "text";
const flag: any = true;
const cfg = { n, t, flag, plain: 10 };
console.log(Object.values(cfg).map((x) => typeof x));
console.log(Object.values(cfg).filter((x) => typeof x === "number"));
console.log(Object.entries(cfg).map(([k, v]) => k + ":" + typeof v));
console.log(Object.entries(cfg).filter(([, v]) => v !== true).map(([k]) => k));
console.log(Object.values(cfg).find((x) => typeof x === "string"));
const [first, second] = Object.values(cfg);
console.log(first, second);
console.log(JSON.stringify(Object.values(cfg)), JSON.stringify(Object.entries(cfg)));
let count = 0;
for (const v of Object.values(cfg)) if (typeof v === "number") count++;
console.log(count);
