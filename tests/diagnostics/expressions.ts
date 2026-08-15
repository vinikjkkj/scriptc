const n: number = 3;
const t = n > 0 ? "pos" : "neg";
const o = { ...{ a: 1 } };
const b = "a" in { a: 1 };
const m = typeof "ab".indexOf("b"); // a CALL operand — folds to "number" after the call runs
const u = n === 3 ? 1 : 2;
const s: string = "abc";
const mixed = n === 3 && s;
console.log(t, m, u, b, mixed);
