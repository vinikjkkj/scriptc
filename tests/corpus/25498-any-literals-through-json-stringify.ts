// JSON.stringify of object and array literals whose members are any-typed (undefined members and nested values included).
const n: any = 5;
const s: any = 'q"x';
const o: any = { a: [1, { b: null }] };
const u: any = undefined;
const f: any = 1.5;
console.log(JSON.stringify({ n, s, o, u }));
console.log(JSON.stringify([n, s, o, u, f]));
console.log(JSON.stringify({ n, o }, null, 2));
console.log(JSON.stringify({ list: [n, s], nested: { o } }));
