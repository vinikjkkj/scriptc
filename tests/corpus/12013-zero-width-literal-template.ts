const v = 3;
const a = `​${v}\u00AD`;
console.log(a.length, a.charCodeAt(0), a.charCodeAt(a.length - 1));
const b = "a\u00ADb\u200Cc\u200Dd\u2060e";
console.log(b.length, b.charCodeAt(1), b.charCodeAt(3), b.charCodeAt(5), b.charCodeAt(7));
