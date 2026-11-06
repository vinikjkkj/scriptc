// A record filled by assignment keeps its keys in write order, and a spread of it into an index-signature record writes them in
// that order (the index record enumerates in insertion order).
interface P { a?: number; b?: number; c?: number }
const f1: P = {}; f1.b = 1; f1.a = 2;
const idx: Record<string, number | undefined> = { ...f1 };
console.log(Object.keys(idx).join(","), JSON.stringify(idx));

const f2: P = { c: 7 }; f2.b = 2; f2.a = 1;
const idx2: Record<string, number | undefined> = { z: 0, ...f2 };
console.log(Object.keys(idx2).join(","), JSON.stringify(idx2));

const idx3: Record<string, number | undefined> = { ...f1, ...f2, y: 5 };
console.log(Object.keys(idx3).join(","), JSON.stringify(idx3));

delete f1.b;
f1.b = 3;
const idx4: Record<string, number | undefined> = { ...f1 };
console.log(Object.keys(idx4).join(","), JSON.stringify(idx4), Object.values(idx4).join(","));
