interface W { inner: number; middle: string; tag: boolean }
const w: W = { tag: true, inner: 1, middle: "m" };
const v: W = { inner: 9, middle: "z", tag: false };
const o: object = w;
console.log(Object.keys(o).join(","), v.inner);
console.log(Object.keys(v).join(","), JSON.stringify(o), JSON.stringify(v));
