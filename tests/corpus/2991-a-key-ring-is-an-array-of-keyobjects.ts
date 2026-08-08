// An array of opaque crypto handles: KeyObject elements are ordinary
// refcounted pointers (scr_keyobj_retain_v/release_v, nothing to trace), so
// a key ring is the same REF storage a ChildProcess[] already uses. This
// spelling used to reach the C emitter and abort with an internal assertion.
import * as crypto from "node:crypto";

const ring: crypto.KeyObject[] = [
  crypto.createSecretKey(Buffer.from("alpha")),
  crypto.createSecretKey(Buffer.from("bravo")),
  crypto.createSecretKey(Buffer.from("charlie")),
];
console.log("ring size", ring.length);

// Each element reads back through the slot as a usable handle.
for (let i = 0; i < ring.length; i++) {
  const h = crypto.createHmac("sha256", ring[i]!);
  h.update("payload");
  console.log(i, h.digest("hex"));
}

// Growing and shrinking the ring exercises retain/release on the slot.
ring.push(crypto.createSecretKey(Buffer.from("delta")));
console.log("after push", ring.length);
const popped = ring.pop()!;
const ph = crypto.createHmac("sha256", popped);
ph.update("payload");
console.log("popped digest", ph.digest("hex"));
console.log("after pop", ring.length);

// A second array sharing the same handles: two owners, one referent.
const mirror: crypto.KeyObject[] = [];
for (let i = 0; i < ring.length; i++) mirror.push(ring[i]!);
console.log("mirror", mirror.length);
const mh = crypto.createHmac("sha256", mirror[2]!);
mh.update("payload");
console.log("mirror[2] digest", mh.digest("hex"));
