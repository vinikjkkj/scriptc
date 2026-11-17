// An `any`-typed value as a member of an object, array or Map literal handed to console.log: the member is the checked-dynamic slot.
const n: any = 5;
const s: any = "str";
const o: any = { a: 1, b: [true, null] };
const nul: any = null;
const arr: any = [1, "two", { three: 3 }];
console.log({ n, s, o });
console.log([n, s, o, nul]);
console.log(new Map([["k", n]]));
console.log(new Map([["a", s], ["b", o], ["c", arr]]));
console.log({ list: [n, s], nested: { inner: [o] }, plain: 1 });
console.log([[n], [s, nul], [arr]]);
console.log("label", { n }, [s]);
function show(v: any): void { console.log({ v }, [v]); }
show(7);
show("x");
show({ z: 1 });
