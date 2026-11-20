const a = new Float64Array([1234.5, -0, 1e21, NaN]);
console.log(a.toLocaleString());
console.log(new Int32Array([1234567, -89]).toLocaleString("de-DE"));
console.log(new Uint8Array([1, 2]).toLocaleString());
console.log(new Float32Array([0.5, 1000.25]).toLocaleString("en-US", { minimumFractionDigits: 2 }));
console.log(new Float64Array(0).toLocaleString());
console.log(new BigInt64Array([123456789012345678n, -5n]).toLocaleString());
