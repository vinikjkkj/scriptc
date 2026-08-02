// `a[i] op= v` over a numeric array or a typed array: read the element,
// combine, write it back. The shapes here are the ones field arithmetic
// uses -- X25519 key clamping, and the carry/reduce loops of a 2^255-19
// field implementation.
//
// JS evaluates the target's receiver and index exactly ONCE. The read and
// the write each lower their own copy of both, so the form is admitted
// only when re-evaluating them cannot be observed: a bare identifier
// receiver, and an index that is a literal, an identifier, or arithmetic
// over those. That is the same bargain `o.f += v` already strikes.
//
// NOT exercised here, because a corpus case has to compile: `a[i++] += v`
// and `a[next()] += v` keep the fence rather than step the index twice.

const priv = new Uint8Array([200, 1, 2, 3]);
priv[0] &= 248;
priv[3] |= 64;
priv[1] ^= 0xff;
console.log(priv[0], priv[1], priv[3]);

const o = [10, 20, 30];
const c = 5;
o[0] += c - 1 + 37 * (c - 1);
console.log(o[0]);

const m = [1, 2, 3, 4];
for (let i = 1; i < 4; i++) { m[i - 1] &= 0x3; }
console.log(m.join(","));

const p = [1, 2], q = [4, 8];
for (let i = 0; i < 2; i++) { const t = 3; p[i] ^= t; q[i] ^= t; }
console.log(p.join(","), q.join(","));

const f = [1.5, 2.5];
f[0] *= 4; f[1] -= 0.5; f[0] /= 2; f[1] %= 2;
console.log(f[0], f[1]);
