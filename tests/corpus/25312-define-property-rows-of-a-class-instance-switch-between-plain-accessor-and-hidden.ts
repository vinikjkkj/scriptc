// defineProperty over a class instance's run-time property table: a default data property, a hidden one, an accessor and back, each
// redefinition keeping the key's position; array values of length 5 and 6; a non-configurable property's redefinition throws.
class Box { name: string; constructor(n: string) { this.name = n; } }
const rt = process.argv.length > 99 ? 'zz' : '';
const kA = 'a' + rt, kB = 'b' + rt, kC = 'c' + rt;
const y = new Box('y');
Object.defineProperty(y, 'late', { value: 6, enumerable: true, writable: true, configurable: true });
Object.defineProperty(y, 'hid', { value: 7, enumerable: false });
Object.defineProperty(y, 'tail', { value: 8, enumerable: true, writable: true, configurable: true });
console.log(y, Object.keys(y as any).join(','), String('hid' in y), (y as any)['hid']);
for (const k in y) console.log('forin', k, (y as any)[k]);
const z = new Box('z');
(z as any)[kA] = 1;
Object.defineProperty(z, kA, { value: 2, enumerable: false, writable: true, configurable: true });
console.log(z, String(kA in z), Object.keys(z as any).join(','), (z as any)[kA]);
Object.defineProperty(z, kA, { value: 9, enumerable: true, writable: true, configurable: true });
console.log(z, (z as any)[kA]);
Object.defineProperty(z, kA, { get: () => 5, enumerable: true, configurable: true });
console.log(z, (z as any)[kA]);
Object.defineProperty(z, kA, { value: [7, 7, 7, 7, 7], enumerable: true, writable: true, configurable: true });
console.log(z, (z as any)[kA]);
Object.defineProperty(z, kA, { value: [7, 7, 7, 7, 7, 7], enumerable: true, writable: true, configurable: true });
console.log(z, (z as any)[kA].length);
(z as any)[kA] = 'set after define';
console.log(z, (z as any)[kA]);
const w = new Box('w');
Object.defineProperty(w, kB, { value: 1, enumerable: true, writable: false, configurable: false });
try { Object.defineProperty(w, kB, { value: 3, enumerable: true, writable: false, configurable: false }); console.log('same redefinition ok'); } catch (e) { console.log('redef', (e as Error).message); }
try { Object.defineProperty(w, kB, { get: () => 3, enumerable: true, configurable: false }); } catch (e) { console.log('redef', (e as Error).message); }
console.log(w, (w as any)[kB]);
const v = new Box('v');
Object.defineProperty(v, kC, { value: 2, enumerable: true, writable: true, configurable: true });
(v as any)[kC] = 3;
console.log(v, (v as any)[kC]);
Object.defineProperty(v, kC, { value: 4, enumerable: false, writable: true, configurable: true });
console.log(v, (v as any)[kC]);
