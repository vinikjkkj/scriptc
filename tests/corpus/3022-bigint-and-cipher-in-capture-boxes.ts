// Capture boxes over the refcounted-but-not-"handle" values: a bigint and
// a Cipher/Decipher pair closed over by an inner function. A captured
// local lives in a heap BOX, and a box whose payload has no runtime-known
// tag must carry the payload's retain/release as function pointers
// (SCR_BOX_OBJ). The list deciding which kinds those are had omitted
// bigint and the whole crypto family, so each of the closures below used
// to ABORT the C emitter ("bigint boxes go through boxNewC, not
// boxKindC") rather than compile or refuse.
import { createCipheriv, createDecipheriv } from "node:crypto";

// ── a bigint capture box ────────────────────────────────────────────────
function accumulator(start: bigint): (add: bigint) => bigint {
  let total = start; // captured => boxed
  return (add: bigint): bigint => {
    total = total + add;
    return total;
  };
}
const acc = accumulator(1000000000000000000n);
console.log("bigint acc", acc(1n).toString());
console.log("bigint acc", acc(2n).toString());
console.log("bigint acc", acc(3n).toString());

// A bigint captured by two closures shares one box.
function pair(): { get: () => bigint; bump: () => void } {
  let n = 7n;
  return { get: (): bigint => n, bump: (): void => { n = n * 3n; } };
}
const p = pair();
p.bump();
p.bump();
console.log("bigint shared", p.get().toString());

// ── a Cipher/Decipher capture box ───────────────────────────────────────
const key = Buffer.from("0123456789abcdef0123456789abcdef", "utf8"); // 32 bytes
const iv = Buffer.from("0123456789abcdef", "utf8"); // 16 bytes

// CTR is a stream cipher, so update() returns everything the chunk
// produced and the closure can be called repeatedly without final().
function sealer(): (plain: Buffer) => string {
  const c = createCipheriv("aes-256-ctr", key, iv); // captured => boxed
  return (plain: Buffer): string => c.update(plain).toString("hex");
}
const seal = sealer();
const part1 = seal(Buffer.from("0123456789abcdef", "utf8"));
const part2 = seal(Buffer.from("fedcba9876543210", "utf8"));
console.log("sealed", part1, part2);

function opener(): (chunk: Buffer) => string {
  const d = createDecipheriv("aes-256-ctr", key, iv); // captured => boxed
  return (chunk: Buffer): string => d.update(chunk).toString("utf8");
}
const open = opener();
console.log("opened", open(Buffer.from(part1, "hex")), open(Buffer.from(part2, "hex")));

// ── the same values as record fields ────────────────────────────────────
interface Counter {
  label: string;
  value: bigint;
}
const counters: Counter[] = [
  { label: "small", value: 42n },
  { label: "large", value: 98765432109876543210n },
];
for (const c of counters) console.log("record", c.label, (c.value * 2n).toString());
