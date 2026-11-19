// X25519 over raw keys wrapped in DER: the two RFC 7748 section 5.2 vectors, the iterated vector (1 and 1000 steps), base-point products of fixed secrets, and low-order and non-canonical peer points.
import { createPrivateKey, createPublicKey, diffieHellman } from "node:crypto";

const PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI = Buffer.from("302a300506032b656e032100", "hex");
const priv = (raw: Buffer) => createPrivateKey({ key: Buffer.concat([PKCS8, raw]), format: "der", type: "pkcs8" });
const pub = (raw: Buffer) => createPublicKey({ key: Buffer.concat([SPKI, raw]), format: "der", type: "spki" });
const h = (s: string) => Buffer.from(s, "hex");
const x = (sk: Buffer, u: Buffer) => diffieHellman({ privateKey: priv(sk), publicKey: pub(u) });
const out: string[] = [];

out.push(x(h("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4"), h("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c")).toString("hex"));
out.push(x(h("4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d"), h("e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493")).toString("hex"));

let k = Buffer.alloc(32); k[0] = 9;
let u = Buffer.alloc(32); u[0] = 9;
for (let i = 1; i <= 1000; i++) {
  const r = x(k, u);
  u = k;
  k = Buffer.from(r);
  if (i === 1 || i === 1000) out.push(k.toString("hex"));
}

for (let i = 0; i < 20; i++) {
  const s = Buffer.alloc(32);
  for (let j = 0; j < 32; j++) s[j] = (i * 37 + j * 11 + (j === i ? 200 : 0)) & 255;
  const base = Buffer.alloc(32);
  base[0] = 9;
  out.push(x(s, base).toString("hex"));
}

const points = [
  "0100000000000000000000000000000000000000000000000000000000000000",
  "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800",
  "5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "0900000000000000000000000000000000000000000000000000000000000080",
  "f6ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "0200000000000000000000000000000000000000000000000000000000000000",
  "fdffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
];
const sk = h("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4");
for (const p of points) {
  try {
    out.push(x(sk, h(p)).toString("hex"));
  } catch {
    out.push("throws");
  }
}
console.log(out.join("\n"));
