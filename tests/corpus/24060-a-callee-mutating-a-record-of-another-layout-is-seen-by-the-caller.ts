// A record handed to a callee under another layout is the same object: the callee's writes are the caller's reads (value model).
interface Base { depth?: number; tag?: string }
interface Wide { tag?: string; extra?: number; depth?: number; validation?: string }
function touch(o: Base): void { o.depth = (o.depth ?? 0) + 100; o.tag = "touched"; }
const o: Wide = { depth: 1, validation: "x" };
touch(o);
console.log(o.depth, o.tag, o.validation);
