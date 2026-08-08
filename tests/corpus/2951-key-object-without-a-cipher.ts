// A KeyObject program that never touches a Cipher — the link set the
// `asym` gate produces ON ITS OWN.
//
// This used to be a BUILD failure, not a wrong answer: scr_asym.c held
// createCipheriv's KeyObject overload, whose body calls scr_cipher_new_raw
// out of scr_cipher_value.c — a unit that rides the separate `cipher`
// gate. Any program that reached a key and no cipher therefore dragged an
// undefined reference all the way to
//
//   lld-link: error: undefined symbol: scr_cipher_new_raw
//
// with no gate named. 2708/2717/2732 all tripped it; this one is the
// minimal shape (zapo's Noise handshake: derive, sign, verify, agree —
// no AES anywhere) so a regression cannot hide behind a large fixture.
//
// Everything printed is also a real behavioural claim, so a binary that
// merely LINKS is not enough.
import { createSecretKey, createHmac, generateKeyPairSync, diffieHellman, sign, verify } from "node:crypto";
import * as crypto from "node:crypto";

// The symmetric half: a handle and the bytes it came from MAC identically.
const material = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const secret = createSecretKey(material);
console.log(createHmac("sha256", secret).update("noise").digest("hex"));
console.log(createHmac("sha256", material).update("noise").digest("hex"));

// The agreement half: X25519, both directions of the same shared secret.
const a = generateKeyPairSync("x25519");
const b = generateKeyPairSync("x25519");
const ab = diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey });
const ba = diffieHellman({ privateKey: b.privateKey, publicKey: a.publicKey });
console.log(ab.length, ab.equals(ba));

// The signature half: Ed25519 over the agreed secret, verified and then
// broken by one byte.
const ed = generateKeyPairSync("ed25519");
const sig = sign(null, ab, ed.privateKey);
console.log(sig.length, verify(null, ab, ed.publicKey, sig));
const tampered = Buffer.from(ab);
tampered[0] = tampered[0]! ^ 0x01;
console.log(verify(null, tampered, ed.publicKey, sig));

// Keys as VALUES: through a parameter and a class field — the shapes that
// keep a keyobj type alive on the IR after the calls themselves are gone.
class Session {
  public readonly staticKey: crypto.KeyObject;
  public readonly ephemeral: crypto.KeyObject;
  public constructor(s: crypto.KeyObject, e: crypto.KeyObject) {
    this.staticKey = s;
    this.ephemeral = e;
  }
}
function agree(priv: crypto.KeyObject, pub: crypto.KeyObject): string {
  return diffieHellman({ privateKey: priv, publicKey: pub }).toString("hex");
}
const s = new Session(a.privateKey, b.privateKey);
// Generated keys are random, so the SECRETS cannot be printed — what is
// pinned is that routing the same pair through a field and through a local
// lands on the same answer, and that the two sides of the pair agree.
console.log(agree(s.staticKey, b.publicKey) === agree(a.privateKey, b.publicKey));
console.log(agree(s.ephemeral, a.publicKey) === agree(a.privateKey, b.publicKey));
console.log(agree(a.privateKey, b.publicKey).length);

// The refusals stay refusals with only this unit linked: a secret key is
// not an agreement key, and an asymmetric one is not HMAC material.
try {
  diffieHellman({ privateKey: secret, publicKey: a.publicKey });
  console.log("dh did not refuse a secret key");
} catch (e) {
  console.log("dh refused a secret key:", e instanceof Error);
}
try {
  createHmac("sha256", a.privateKey).update("noise").digest("hex");
  console.log("hmac did not refuse an asymmetric key");
} catch (e) {
  console.log("hmac refused an asymmetric key:", e instanceof TypeError);
}
