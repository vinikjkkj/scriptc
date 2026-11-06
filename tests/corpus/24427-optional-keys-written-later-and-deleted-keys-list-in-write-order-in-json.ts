interface P { a?: number; b?: number; c?: number }
const f1: P = {}; f1.b = 1; f1.a = 2;
const f2: P = {}; f2.a = 3; f2.c = 4; f2.b = 5;
console.log(JSON.stringify(f1), JSON.stringify(f2));
delete f2.a; f2.a = 9;
console.log(JSON.stringify(f2));
const f3: P = { c: 7 }; f3.a = 1; f3.b = 2; f3.c = 8;
console.log(JSON.stringify(f3));
