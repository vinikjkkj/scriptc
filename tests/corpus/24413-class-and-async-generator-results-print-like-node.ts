class C { *g(): Generator<number, string, undefined> { yield 1; return "r"; } }
const it = new C().g();
console.log(it.next()); console.log(it.next()); console.log(it.next());
console.log(Object.keys(it.next()));
async function* ag(): AsyncGenerator<number, void, undefined> { yield 5; }
async function main() { const a = ag(); console.log(await a.next()); const d = await a.next(); console.log(d); console.log([d]); }
main();
const rec = { r: new C().g().next() }; console.log(rec);
