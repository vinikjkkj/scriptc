// A dyn JSON object cast to a record with OPTIONAL members: an absent key reads
// undefined, `in` is false, JSON omits it, and inspect omits it.
const B: { a?: number; s?: string } = JSON.parse('{"s":"v"}');
console.log(B.a, B.s, 's' in B, 'a' in B, B.a === undefined);
console.log(JSON.stringify(B), B);
const C: { a?: number; b?: string } = JSON.parse('{}');
console.log(C.a, C.b, 'a' in C, JSON.stringify(C), C);
