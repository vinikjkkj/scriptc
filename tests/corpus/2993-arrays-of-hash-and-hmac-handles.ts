// Hash and Hmac handles in arrays: refcounted digest state behind
// scr_hash_*/scr_hmac_* `_v` adapters, nothing to trace. A rolling-digest
// column used to abort the C emitter with an internal assertion.
import * as crypto from "node:crypto";

const hashes = [
  crypto.createHash("sha256"),
  crypto.createHash("sha1"),
  crypto.createHash("md5"),
];
const names = ["sha256", "sha1", "md5"];
for (let i = 0; i < hashes.length; i++) hashes[i]!.update("the same message");
for (let i = 0; i < hashes.length; i++) console.log(names[i], hashes[i]!.digest("hex"));

const macs = [
  crypto.createHmac("sha256", "k1"),
  crypto.createHmac("sha256", "k2"),
];
console.log("mac count", macs.length);
for (let i = 0; i < macs.length; i++) {
  macs[i]!.update("body");
  console.log(i, macs[i]!.digest("base64"));
}

// Fresh handles pushed after construction take the same slot machinery.
const more: crypto.Hash[] = [];
more.push(crypto.createHash("sha512"));
more[0]!.update("tail");
console.log("sha512", more[0]!.digest("hex").slice(0, 32));
console.log("more", more.length, "indexOf", more.indexOf(more[0]!));
