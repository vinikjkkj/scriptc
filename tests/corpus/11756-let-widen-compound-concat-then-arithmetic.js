// A compound += that turns a number binding into a string, followed by
// arithmetic on the result: the string concatenation rule applies to the
// current value at each step.
let n = 5;
n += 'px';
console.log(n, typeof n, n.length);
n = 3;
n += 4;
console.log(n, typeof n);
let m = 'a';
m += 1;
m += 2;
console.log(m, typeof m, m.length);
