type W1 = { a: number; b: number };
type W2 = { a: number; b: number; c?: number };
function mk(n: number): W1 { if (n < 2) return { a: n, b: 1 }; return { b: 2, a: n }; }
const w2: W2 = { a: 5, b: 6, c: 7 };
const w1: W1 = w2;
console.log(JSON.stringify(mk(1)), JSON.stringify(mk(2)), JSON.stringify(w1));
console.log(mk(1), mk(2));
