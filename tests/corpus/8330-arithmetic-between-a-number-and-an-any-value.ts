function get(): any { return JSON.parse('{"a":5,"s":"7","u":null,"b":true,"n":-2.5}'); }
const o = get();
const n: number = 2;
console.log(n + o.a, o.a + n, n * o.a, n - o.a, n / o.a, n % o.a, n < o.a, n ** o.a);
console.log(n + o.s, o.s + n, "k" + o.a, o.s - n);
console.log(n + o.u, n + o.b, n + o.zzz, n * o.zzz, o.u + o.b);
let t = 1; t += o.a; t -= o.s; t *= o.n; console.log(t);
let s = "x"; s += o.a; console.log(s);
console.log(-o.a, +o.a, +o.s, -o.s, ~o.a, o.a * 2, o.s > n, o.a >= o.s);
function f(x: any, y: any): void { console.log(x + y, x - y, x * y, x < y, x === y); }
f(1, 2); f("1", 2); f("a", "b"); f(null, 3);
console.log(o.a === 5, o.s === "7", o.a === o.s, o.a !== 5, o.u === null, o.q === undefined);
