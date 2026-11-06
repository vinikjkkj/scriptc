// Object.assign onto an index-signature record writes a source that was filled by assignment in the order its keys were written.
interface P { a?: number; b?: number; c?: number }
const f1: P = {}; f1.b = 1; f1.a = 2;
const t: Record<string, number | undefined> = {};
Object.assign(t, f1);
console.log(Object.keys(t).join(","), JSON.stringify(t));
const f2: P = { c: 7 }; f2.b = 2; f2.a = 1;
const t2: Record<string, number | undefined> = { z: 0 };
Object.assign(t2, f2, f1);
console.log(Object.keys(t2).join(","), JSON.stringify(t2));
delete f1.b; f1.b = 9;
const t4: Record<string, number | undefined> = {};
Object.assign(t4, f1);
console.log(Object.keys(t4).join(","), JSON.stringify(t4));
