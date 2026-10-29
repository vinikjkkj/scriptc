// An Object.create(null) table with NO declared type keeps Node's null-prototype
// behaviour: members set one by one are read and called, `in` and `toString`
// see no Object.prototype, Object.keys follows insertion order, JSON and
// console.log render the table as Node does.
function parse(s: string): number { return s.length; }
function stringify(n: number): string { return "n" + n; }
const B = Object.create(null);
console.log(B.parse, "toString" in B, B.toString);
B.parse = parse;
B.stringify = stringify;
console.log(B.parse("abc"), B.stringify(4), "toString" in B, B.toString, "parse" in B);
console.log(Object.keys(B).join(","), JSON.stringify(B));
console.log(B);
const C = Object.create(null);
C.b = 2;
C.a = 1;
console.log(Object.keys(C).join(","), JSON.stringify(C));
console.log(C);
