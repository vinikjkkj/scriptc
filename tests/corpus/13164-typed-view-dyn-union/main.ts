// Typed views box into `unknown` as one dyn kind, and the element tells
// them apart: an Int8Array is not a Uint8Array to `instanceof`, a
// Float32Array does not take the Int16Array arm of a union, and the
// clamped and bigint views round-trip with their own element.
type Pcm = Int16Array | Float32Array;
type Rec = { id: number; pcm: Pcm };
const pcmKeep: Pcm = new Float32Array([1]);
console.log(pcmKeep instanceof Float32Array);

const items: unknown[] = [
  new Int8Array([1, -2]),
  new Uint8Array([3, 4]),
  new Float32Array([0.5]),
  new Uint8ClampedArray([300, -5]),
  new BigInt64Array([7n]),
  new Int16Array([-9]),
];

for (const it of items) {
  console.log(it instanceof Uint8Array);
}

const rec: unknown = { id: 1, pcm: new Float32Array([2.5]) };
const back = rec as Rec;
const f = back.pcm as Float32Array;
console.log(back.id, f[0]);

const again = items[5] as Int16Array;
console.log(again[0]);
