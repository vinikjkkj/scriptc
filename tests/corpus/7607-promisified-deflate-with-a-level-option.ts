// util.promisify(deflate) called WITH node:zlib's `{ level }` option — the
// spelling zapo's companion-host history sync uses:
//
//   const deflateAsync = promisify(deflate)
//   const compressed = await deflateAsync(serialized, { level: 1 })
//
// The level is not a setting that can be dropped: it changes the compressed
// BYTES. So it reaches the codec rather than being ignored, and what this
// file checks is the round trip plus the properties a level actually has —
// level 0 stores (never smaller than the input), level 9 is not larger than
// level 1 on compressible input, and every level inflates back to exactly
// the bytes that went in.
//
// It deliberately does NOT compare compressed bytes against Node's: zlib's
// output is version-dependent, which is why every zlib program in this
// corpus tests round trips and fixed-blob inflation instead.

import { promisify } from "node:util";
import { deflate, inflateSync } from "node:zlib";

const deflateAsync = promisify(deflate);

function payload(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7) % 11 === 0 ? 65 : 66 + (i % 3);
  return out;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function main(): Promise<void> {
  const data = payload(4096);

  // Every level round-trips to the identical bytes.
  const levels = [0, 1, 6, 9];
  const sizes: number[] = [];
  for (const level of levels) {
    const packed = await deflateAsync(data, { level: level });
    const back = inflateSync(packed);
    sizes.push(packed.length);
    console.log(`level=${level} roundtrip=${same(back, data)} backLen=${back.length}`);
  }

  // Level 0 stores: it cannot be smaller than the input.
  console.log(`stored>=input ${sizes[0]! >= data.length}`);
  // Levels 1 and 9 both compress this input well below its size, and 9 is
  // never worse than 1.
  console.log(`l1<input ${sizes[1]! < data.length}`);
  console.log(`l9<input ${sizes[3]! < data.length}`);
  console.log(`l9<=l1 ${sizes[3]! <= sizes[1]!}`);

  // The option-less form still works and still round-trips.
  const plain = await deflateAsync(data);
  console.log(`default roundtrip=${same(inflateSync(plain), data)} smaller=${plain.length < data.length}`);

  // A tiny and an empty input, at an explicit level.
  const tiny = await deflateAsync(new Uint8Array([1, 2, 3]), { level: 1 });
  console.log(`tiny roundtrip=${same(inflateSync(tiny), new Uint8Array([1, 2, 3]))}`);
  const empty = await deflateAsync(new Uint8Array(0), { level: 9 });
  console.log(`empty roundtrip=${inflateSync(empty).length}`);

  // The level as a computed number, not a literal.
  const chosen = data.length > 1000 ? 1 : 6;
  const dyn = await deflateAsync(data, { level: chosen });
  console.log(`computed roundtrip=${same(inflateSync(dyn), data)} sameAsL1=${dyn.length === sizes[1]}`);

  // The zapo shape: a helper that takes the payload and the phone's level.
  async function compressAt(bytes: Uint8Array, level: number): Promise<number> {
    const out = await deflateAsync(bytes, { level: level });
    return same(inflateSync(out), bytes) ? out.length : -1;
  }
  const n1 = await compressAt(data, 1);
  const n9 = await compressAt(data, 9);
  console.log(`helper ok=${n1 > 0 && n9 > 0} ordered=${n9 <= n1}`);
}

void main();
