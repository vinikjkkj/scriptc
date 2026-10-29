// The same optional record with the keys present: the present path is unchanged.
const P: { a?: number; b?: string } = JSON.parse('{"a":3,"b":"x"}');
console.log(P.a, P.b, 'a' in P, JSON.stringify(P), P);
const Q: { a?: number; b?: string } = JSON.parse('{"b":"y"}');
console.log(Q.a, Q.b, 'a' in Q, JSON.stringify(Q), Q);
console.log(Q.a === undefined ? 'absent' : 'present', Q.b);
