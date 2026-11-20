console.log(Uint8Array.of(1, 2, 300, -1), Float64Array.of(1.5, NaN), Int16Array.of(), Float32Array.of(0.1));
console.log(BigInt64Array.of(1n, -2n), BigUint64Array.of(5n));
console.log(Uint8Array.of(7).constructor === Uint8Array, Buffer.isBuffer(Uint8Array.of(1)));
function f() { return 3; }
console.log(Int32Array.of(f(), f() + 1).length);
console.log(new Float64Array(new Int32Array([1, -2, 3])), new Uint8Array(new Float32Array([1.5, 300, -1])), new Int16Array(new Uint8Array([200, 7])));
console.log(new Uint8ClampedArray(new Float64Array([300, -4, 1.5])));
