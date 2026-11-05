// `const b: Base = w` between two layouts is the same object, not a copy: a write through either is a read through the other.
interface Base { n: number }
interface Wide { label: string; n: number }
const w: Wide = { label: "a", n: 1 };
const b: Base = w;
b.n = 42;
console.log(w.n, b.n);
w.n = 7;
console.log(w.n, b.n);
