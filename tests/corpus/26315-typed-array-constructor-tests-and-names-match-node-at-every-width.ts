const f = new Float64Array(2);
console.log(f.constructor === Float64Array, Float64Array === f.constructor);
console.log(f.constructor !== Uint8Array, f.constructor === Int32Array, f.constructor !== Float64Array);
console.log(f.constructor.name);
const u = new Uint8Array(2);
console.log(u.constructor === Uint8Array, u.constructor === Float32Array, u.constructor.name);
const b = Buffer.from("a");
console.log(b.constructor === Uint8Array, b.constructor === Buffer, b.constructor.name);
const i8 = new Int8Array(1), c8 = new Uint8ClampedArray(1), g = new BigUint64Array(1), h = new Float32Array(1);
console.log(i8.constructor.name, c8.constructor.name, g.constructor.name, h.constructor.name, new Uint16Array(1).constructor.name);
function mk() { console.log("mk"); return new Int16Array(2); }
console.log(mk().constructor === Int16Array, mk().constructor.name, mk().constructor === Uint8Array);
const dv = new DataView(new ArrayBuffer(4));
console.log(dv.constructor === Uint8Array);
