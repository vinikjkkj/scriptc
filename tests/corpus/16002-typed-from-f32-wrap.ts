// Cross-kind copies from a Float32Array: each element converts with the TARGET kind's wrap
// (65537.9 -> 1 in uint16, -1 -> 65535, 70000.5 -> 4464, 300 -> 44 in uint8).
const f: Float32Array = new Float32Array([65537.9, -1, 70000.5, 300]);
const w2: Uint16Array = Uint16Array.from(f);
const w8: Uint8Array = Uint8Array.from(f);
console.log(Array.from(w2).join(","), Array.from(w8).join(","));
const back: number[] = Array.from(f, (v: number) => v * 2);
console.log(back.join(","));
