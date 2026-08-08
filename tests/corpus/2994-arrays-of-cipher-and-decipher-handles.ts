// Cipher/Decipher handles in arrays: refcounted stream state behind
// scr_cipher_retain_v/release_v, nothing to trace. Both spellings used to
// abort the C emitter with an internal assertion.
import * as crypto from "node:crypto";

const key = Buffer.alloc(32, 7);
const iv = Buffer.alloc(16, 3);

const encs = [
  crypto.createCipheriv("aes-256-cbc", key, iv),
  crypto.createCipheriv("aes-256-cbc", key, iv),
];
console.log("encs", encs.length);

const plain = [Buffer.from("first message"), Buffer.from("second message")];
const cts: Buffer[] = [];
for (let i = 0; i < encs.length; i++) {
  const a = encs[i]!.update(plain[i]!);
  const b = encs[i]!.final();
  const ct = Buffer.concat([a, b]);
  cts.push(ct);
  console.log("ct", i, ct.toString("hex"));
}

const decs = [
  crypto.createDecipheriv("aes-256-cbc", key, iv),
  crypto.createDecipheriv("aes-256-cbc", key, iv),
];
for (let i = 0; i < decs.length; i++) {
  const a = decs[i]!.update(cts[i]!);
  const b = decs[i]!.final();
  console.log("pt", i, Buffer.concat([a, b]).toString("utf8"));
}
console.log("roundtrip ok", decs.length === encs.length);
