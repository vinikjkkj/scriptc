const e = new Event('x');
console.log(e instanceof Event);
function f(v: number | Event) { return v instanceof Event; }
console.log(f(e), f(5));
function h(v: { a: number } | Event) { return v instanceof Event; }
console.log(h(e), h({ a: 1 }));
