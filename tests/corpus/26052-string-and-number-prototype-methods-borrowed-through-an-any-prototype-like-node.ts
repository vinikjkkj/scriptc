// String.prototype / Number.prototype methods read through an any-typed prototype are the real functions: .call over other receivers coerces like Node, reads are identical.
const p: any = String.prototype;
console.log(p.charAt.call("abc", 1), p.toUpperCase.call("abc"), p.slice.call("hello", 1, 3), p.indexOf.call(12345, "3"));
console.log(typeof p.charAt, typeof p.nope, p.charAt === p.charAt);
const n: any = Number.prototype;
console.log(n.toFixed.call(3.14159, 2), n.toString.call(255, 16));
const q: any = (String as any).prototype;
console.log(q.trim.call("  x "), q.padStart.call("5", 3, "0"));
const p2: any = String.prototype;
console.log(p2.charAt.call("abc", 1), p2.toUpperCase.call("abc"), p2.slice.call("hello", 1, 3));
