// Nested optional records: an absent inner object reads undefined, and a present
// one with an absent member reads undefined one level down.
const N: { o?: { a?: number; tag?: string } } = JSON.parse('{"o":{"tag":"t"}}');
console.log(N.o?.a, N.o?.tag, N.o === undefined, JSON.stringify(N), N);
const M: { o?: { a?: number; tag?: string } } = JSON.parse('{}');
console.log(M.o?.a, M.o === undefined, JSON.stringify(M), M);
