// npm-static pilot: an UNTYPED CJS package whose whole body is bitwise
// arithmetic on implicit-`any` parameters — the varint / zigzag /
// 64-bit-split core of a generated protobuf runtime.
//
// `&`, `|`, `^`, `<<`, `>>`, `>>>` on a checked-dynamic operand lower to
// the same JS-exact node the static f64 case emits (ToInt32/ToUint32:
// NaN/±Infinity → 0, truncate, wrap mod 2^32, shift counts masked to 5
// bits), so this whole program is static and byte-matches Node. The cases
// below drive every operator, both sign domains, the 2^31 and 2^32
// boundaries, and the shift-count mask.
import varint from "varintish";

const hex = (bytes: number[]): string => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

const out: number[] = [];
varint.writeVarint32(out, varint.tag(1, 2));
varint.writeVarint32(out, 0);
varint.writeVarint32(out, 1);
varint.writeVarint32(out, 127);
varint.writeVarint32(out, 128);
varint.writeVarint32(out, 300);
varint.writeVarint32(out, 16383);
varint.writeVarint32(out, 16384);
varint.writeVarint32(out, 0xdeadbeef);
varint.writeVarint32(out, 0xffffffff);
console.log("varint", out.length, hex(out));

// zigzag, both signs and both 32-bit extremes.
const zz: number[] = [0, 1, -1, 2, -2, 2147483647, -2147483648, -3];
console.log("zigzag", zz.map((v) => varint.zigZag32(v)).join(","));

// The 64-bit split: lo/hi zigzag and the varint length ladder.
console.log(
  "long",
  varint.loZigZag(0xdeadbeef, 0x0000cafe),
  varint.hiZigZag(0xdeadbeef, 0x0000cafe),
  varint.loZigZag(1, -1),
  varint.hiZigZag(1, -1),
);
console.log(
  "len",
  [
    varint.varint64Len(0, 0),
    varint.varint64Len(127, 0),
    varint.varint64Len(128, 0),
    varint.varint64Len(0xdeadbeef, 0),
    varint.varint64Len(0, 1),
    varint.varint64Len(0xdeadbeef, 0x0000cafe),
    varint.varint64Len(0, 0xffffffff),
    varint.varint64Len(0xffffffff, 0xffffffff),
  ].join(","),
);

// Tag composition, the shift-count mask (JS takes counts mod 32), the
// `^`/`|` pair, and `&`.
console.log("tag", varint.tag(1, 0), varint.tag(15, 2), varint.tag(2047, 5));
console.log("rotl", varint.rotl(0x12345678, 1), varint.rotl(0x12345678, 8), varint.rotl(0x12345678, 31));
console.log("mix", varint.mix(0xdeadbeef, 0x0000cafe), varint.mix(-1, 0), varint.mix(0, 0));
console.log("mask8", varint.mask8(0x1ff), varint.mask8(-1), varint.mask8(255.9));
