// An unannotated `const a = []` whose pushes close its element type: the
// binding is string[] (tsc's evolving-array analysis, not `any[]`).
const a = [];
a.push("s");
console.log(a, a.length);
