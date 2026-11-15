// Undeclared properties written onto a class instance through an untyped receiver live in the instance's run-time property table:
// plain data values (arrays whose length is 5 and 6 included, undefined, small and large numbers, -0), overwrites that keep the
// key's position, integer-like keys first, `in`, for-in, delete and re-adding after a delete.
class Box { name: string; constructor(n: string) { this.name = n; } }
const rt = process.argv.length > 99 ? 'zz' : '';
const kA = 'a' + rt, kB = 'b' + rt, kC = 'c' + rt, kD = 'd' + rt, kE = 'e' + rt;
Object.defineProperty(new Box('seed'), 'seed' + rt, { value: 0, enumerable: true, writable: true, configurable: true }); // names the class: it carries a table
const x = new Box('x');
(x as any)[kA] = 1;
(x as any)[kB] = [1, 2, 3, 4, 5];
(x as any)[kC] = [1, 2, 3, 4, 5, 6];
(x as any)[kD] = undefined;
(x as any)[kE] = { deep: 1 };
console.log(x);
console.log(Object.keys(x as any).join(','));
console.log((x as any)[kA], (x as any)[kB].length, (x as any)[kC].length, (x as any)[kD], (x as any)[kE].deep);
console.log(String(kA in x), String(kD in x), String('zzz' in x));
(x as any)[kA] = 2;
(x as any)[kA] = 3000;
console.log(x, JSON.stringify(x as any));
const y = new Box('y');
for (const k of ['z', '10', '2', 'm']) (y as any)[k] = k.length;
console.log(y, Object.keys(y as any).join(','));
for (const k in y) console.log('forin', k, (y as any)[k]);
const d = new Box('d');
for (const k of ['p', 'q', 'r']) (d as any)[k] = k;
delete (d as any)['q'];
console.log(d, Object.keys(d as any).join(','));
(d as any)['q'] = 'again';
console.log(d, Object.keys(d as any).join(','));
const n = new Box('n');
(n as any)[kA] = 0; (n as any)[kB] = 1023; (n as any)[kC] = 1024; (n as any)[kD] = -128; (n as any)[kE] = -0;
console.log(n, Object.is((n as any)[kE], -0));
const many: Box[] = [];
for (let i = 0; i < 2500; i++) { const b = new Box('m' + i); (b as any)[kA] = i; many.push(b); }
let sum = 0;
for (let i = 0; i < many.length; i++) sum += (many[i] as any)[kA];
console.log(sum, (many[1500] as any)[kA], many[2499]);
