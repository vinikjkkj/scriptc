interface Ops { all?: ReadonlyArray<any>; some?: readonly any[]; n: number }
const o: Ops = { all: [1, "a", { k: 2 }], some: ["x", 3], n: 4 };
console.log(o.all!.length, o.some!.length, o.n);
