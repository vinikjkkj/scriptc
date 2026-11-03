// What survives a copy and where holes sort: slice/concat/splice/reverse keep holes; spread,
// Array.from and for-of yield undefined; sort puts holes after every element.
const a: number[] = new Array(5);
a[0] = 3;
a[2] = 1;
a[4] = 2;
console.log(a.slice(), a.slice(1, 3), a.concat(a), a.concat([9]));
console.log([...a], Array.from(a));
for (const v of a) console.log("of", v);
console.log(a.reverse(), a.reverse());
console.log(a.slice().sort((x, y) => x - y));
console.log(a.splice(1, 2), a, a.length);
const s: string[] = new Array(5);
s[0] = "b";
s[2] = "a";
s[4] = "c";
console.log(s.slice(), s.concat(s), s.reverse(), s.reverse());
console.log(s.slice().sort(), s.length);
console.log(s.splice(1, 2), s, s.length);
const t: string[] = new Array(3);
t[0] = "x";
t.push("y");
console.log(t, t.length, t.pop(), t.length, t.shift(), t);
const u: (string | undefined)[] = new Array(3);
console.log([...u], Array.from(u), u.slice(), u.concat(u));
for (const v of u) console.log("of", v);
