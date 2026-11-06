type R = { a: number; b: number };
function mk(n: number): R { if (n < 2) return { a: n, b: 1 }; return { b: 2, a: n }; }
const x = mk(1), y = mk(2);
console.log(JSON.stringify(x), JSON.stringify(y));
const p1 = JSON.parse('{"b":1,"a":2}') as R;
const p2 = JSON.parse('{"a":3,"b":4}') as R;
const u = JSON.parse('{"b":5,"a":6}') as R | string;
const v = JSON.parse('{"a":7,"b":8}') as R | number;
console.log(JSON.stringify(p1), JSON.stringify(p2), JSON.stringify(u), JSON.stringify(v));
