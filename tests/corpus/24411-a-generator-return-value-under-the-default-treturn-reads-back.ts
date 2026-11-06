function* f(): Generator<number> { yield 1; yield 2; return 99; }
const it = f();
console.log(it.next(), it.next(), it.next());
for (const x of f()) console.log("x", x + 1);
function* s(): Generator<string, string> { yield "a"; return "end"; }
const j = s(); console.log(j.next().value, j.next().value);
function* r(): Generator<number> { const a = yield 1; return "str"; }
const k = r(); console.log(k.next(), k.next());
