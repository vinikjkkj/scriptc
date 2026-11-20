// Array.prototype as an any value: its methods are the real functions, .call over arrays, strings and array-like objects answers like Node.
const p: any = Array.prototype;
console.log(p.slice.call([1, 2, 3], 1).join(), p.join.call("abc", "-"), p.indexOf.call({ length: 2, 0: "a", 1: "b" }, "b"), typeof p.map, typeof p.nope);
console.log(p.slice === p.slice, p.map.call([1, 2], (x: number) => x * 2).join());
