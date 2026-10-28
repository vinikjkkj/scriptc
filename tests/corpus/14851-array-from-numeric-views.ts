// Array.from(view) over the numeric typed arrays and a Buffer: the element
// list, exactly as Node (saturating and wrapping element stores included).
const u8 = new Uint8Array([1, 2, 255]);
console.log(Array.from(new Uint8Array(u8.buffer)).join(","));
console.log(Array.from(new Int16Array([-1, 300])).join(","));
console.log(Array.from(new Float32Array([1.5, 0.1])).join(","));
console.log(Array.from(new Uint8ClampedArray([300, -5])).join(","));
console.log(Array.from(new Int8Array([200])).join(","));
console.log(Array.from(new Uint32Array([4294967295])).join(","));
console.log(Array.from(Buffer.from("hi")).join(","));
console.log(Array.from(new Float64Array([2.5])).map((x) => x * 2).join(","));
console.log(Array.from(new Uint8Array(0)).length);
