// createSecretKey: the SYMMETRIC KeyObject. The same opaque handle the
// asymmetric surface uses (@types/node spells both `KeyObject`), carrying
// arbitrary key material instead of a curve point. HMAC is what makes it
// OBSERVABLE — a secret key and the raw bytes it was built from must
// produce the same MAC — and every ASYMMETRIC operation must refuse it the
// way Node does rather than read a curve point that is not there.
import { createSecretKey, createHmac, generateKeyPairSync, diffieHellman } from "node:crypto";
import * as crypto from "node:crypto";

// Buffer material and string material: keyed by the KeyObject and by the
// raw material, the two MACs agree.
const raw = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const k1 = createSecretKey(raw);
console.log(createHmac("sha256", k1).update("abc").digest("hex"));
console.log(createHmac("sha256", raw).update("abc").digest("hex"));

const k2 = createSecretKey("a passphrase");
console.log(createHmac("sha512", k2).update("abc").digest("hex"));
console.log(createHmac("sha512", "a passphrase").update("abc").digest("hex"));

const k3 = crypto.createSecretKey(Buffer.from([1, 2, 3, 4]));
console.log(createHmac("sha1", k3).update("abc").digest("base64"));
console.log(createHmac("sha1", Buffer.from([1, 2, 3, 4])).update("abc").digest("base64"));

// A key LONGER than the block: the KeyObject path must hash it down the
// same way the raw path does (RFC 2104).
const longKey = Buffer.from("k".repeat(200), "utf8");
console.log(createHmac("sha256", createSecretKey(longKey)).update("abc").digest("hex"));
console.log(createHmac("sha256", longKey).update("abc").digest("hex"));

// The material is COPIED at construction — overwriting the caller's buffer
// afterwards must not change the MAC.
const mutable = Buffer.from("original-key-material", "utf8");
const pinned = createSecretKey(mutable);
mutable.fill(0);
console.log(createHmac("sha256", pinned).update("abc").digest("hex"));
console.log(createHmac("sha256", Buffer.from("original-key-material", "utf8")).update("abc").digest("hex"));

// The handle is a reference: through a parameter, a return, and a class
// field (zapo's WaNoiseSocket shape).
function pass(k: crypto.KeyObject): crypto.KeyObject {
  return k;
}
class Channel {
  public readonly encryptKey: crypto.KeyObject;
  public readonly decryptKey: crypto.KeyObject;
  public constructor(enc: Uint8Array, dec: Uint8Array) {
    this.encryptKey = createSecretKey(enc);
    this.decryptKey = createSecretKey(dec);
  }
}
const ch = new Channel(Buffer.from("enc-key-material", "utf8"), Buffer.from("dec-key-material", "utf8"));
console.log(createHmac("sha256", pass(ch.encryptKey)).update("frame").digest("hex"));
console.log(createHmac("sha256", ch.decryptKey).update("frame").digest("hex"));

// A ZERO-LENGTH secret key is legal in Node — it constructs, and HMAC
// keyed by it equals HMAC keyed by an empty buffer.
console.log(createHmac("sha256", createSecretKey(Buffer.alloc(0))).update("abc").digest("hex"));
console.log(createHmac("sha256", Buffer.alloc(0)).update("abc").digest("hex"));

// A secret key is NOT an asymmetric key and an asymmetric key is not a
// secret one: the operations that read the wrong half must refuse. Node
// raises ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE (a TypeError) both ways; the
// point pinned here is that it throws rather than answering something
// made up.
const pair = generateKeyPairSync("x25519");
try {
  diffieHellman({ privateKey: k1, publicKey: pair.publicKey });
  console.log("dh did not refuse");
} catch (e) {
  console.log("dh refused a secret key:", e instanceof Error);
}
try {
  createHmac("sha256", pair.privateKey).update("abc").digest("hex");
  console.log("hmac did not refuse");
} catch (e) {
  console.log("hmac refused an asymmetric key:", e instanceof TypeError);
}

// The asymmetric keys beside it keep working — one kind must not have
// broken the other.
const shared = diffieHellman({ privateKey: pair.privateKey, publicKey: pair.publicKey });
console.log(shared.length);
