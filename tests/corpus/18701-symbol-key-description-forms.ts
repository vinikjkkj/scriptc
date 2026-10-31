// The description spellings a literal key can take: a description-less
// Symbol() prints Symbol(), Symbol.for keeps its registry key, and two
// distinct symbols with the same description both print.
const anon = Symbol();
const reg = Symbol.for("registry.key");
const d1 = Symbol("same");
const d2 = Symbol("same");
console.log({ x: 1, [anon]: 2 });
console.log({ [reg]: "r", y: 2 });
console.log({ [d1]: 1, [d2]: 2 });
console.log(Symbol.keyFor(reg), Object.keys({ [reg]: 1 }).length);
