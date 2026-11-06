interface P { a?: number; b?: number; c?: number }
const p = JSON.parse('{"c":1,"a":2}') as P;
console.log(Object.keys(p).join(","), JSON.stringify(p), p);
p.b = 5;
console.log(Object.keys(p).join(","), JSON.stringify(p), p);
const q: P = {}; q.b = 1; q.a = 2;
console.log(Object.keys(q).join(","));
interface P2 { a?: number; b?: string; c?: number }
function mk2(s: string): P2 { return JSON.parse(s) as P2; }
const p2 = mk2('{"c":1,"b":"x","a":2}');
delete p2.b;
p2.b = "y";
console.log(Object.keys(p2).join(","), JSON.stringify(p2), p2);
const r2 = mk2('{"b":"x"}'); r2.c = 3; r2.a = 4;
console.log(Object.keys(r2).join(","), JSON.stringify(r2), r2);
