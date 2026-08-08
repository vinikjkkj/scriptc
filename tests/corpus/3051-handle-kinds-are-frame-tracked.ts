// bigint and the four crypto handles (KeyObject, Hash, Hmac, Cipher) became
// `isRefCounted` kinds, so their values are frame-tracked like every other
// heap value: temps released at statement end, locals at scope end, a
// reassignment releasing the old value, a container owning its payload.
//
// Every shape below is one the RC discipline could get WRONG in the
// direction that matters — an extra release, not a missing one. Missing
// releases are what the RC audit already reports; a double release is
// silent, so the shapes are here to be RUN, and they must answer Node byte
// for byte while doing it.
import { createHash, createHmac, createCipheriv, createDecipheriv, createSecretKey } from "node:crypto";

const KEY = Buffer.alloc(32, 3);
const IV = Buffer.alloc(16, 5);

// ── reassignment: the old handle is released, the new one owned ───────
let h = createHash("sha256");
h.update("first");
h = createHash("sha256"); // the first handle dies here
h.update("second");
console.log("reassign", h.digest("hex"));

let big = 2n;
big = big * 3n;
big = big + 1n;
big = big * big;
console.log("bigint-reassign", big.toString());

// ── aliasing: two names for one handle, both go out of scope ──────────
{
  const a = createHash("sha512");
  const b = a; // same handle, one more owner
  a.update("x");
  b.update("y"); // one message, written through two names
  console.log("alias", b.digest("hex").length); // digest ONCE: Node finalizes
}

// ── a handle that outlives the block it was made in ───────────────────
function makeSeeded(): ReturnType<typeof createHash> {
  const inner = createHash("sha256");
  inner.update("seed");
  return inner; // ownership leaves the frame
}
console.log("escape", makeSeeded().update("-tail").digest("hex"));

// ── parameter ownership: taken, used, dropped by the callee ───────────
function absorb(target: ReturnType<typeof createHash>, s: string): string {
  target.update(s);
  return target.digest("hex");
}
console.log("param", absorb(createHash("sha256"), "abc"));
// The caller keeps a name for a handle the callee also holds: the callee
// must not release out from under it, and the caller must not release
// twice when its own name goes out of scope.
const kept = createHash("sha256");
kept.update("head-");
console.log("param-shared", absorb(kept, "abc"));

// ── conditional production: only one arm's handle is ever made ────────
for (const wide of [true, false]) {
  const c = wide ? createHash("sha512") : createHash("sha256");
  c.update("branch");
  console.log("ternary", wide, c.digest("hex").length);
}

// ── a loop body making and dropping a handle every iteration ──────────
let acc = "";
for (let i = 0; i < 5; i += 1) {
  const loopH = createHash("sha256");
  loopH.update("i" + i);
  acc += loopH.digest("hex").slice(0, 4);
  const loopM = createHmac("sha256", "k" + i);
  loopM.update("i" + i);
  acc += loopM.digest("hex").slice(0, 4);
}
console.log("loop", acc);

// ── early return with a live handle in scope ──────────────────────────
function earlyOut(n: number): string {
  const live = createHmac("sha512", "key");
  live.update("body");
  if (n < 0) return "negative"; // `live` must be released on THIS path too
  const second = createHash("sha256");
  second.update("more");
  if (n === 0) return "zero"; // and both on this one
  return live.digest("hex").slice(0, 8) + second.digest("hex").slice(0, 8);
}
console.log("early", earlyOut(-1), earlyOut(0), earlyOut(1));

// ── unwind: a throw across a frame holding handles ────────────────────
function throwsWithLive(kind: string): string {
  const live = createHash("sha256");
  live.update(kind);
  const c = createCipheriv("aes-256-cbc", KEY, IV);
  if (kind === "boom") throw new Error("boom-" + live.digest("hex").slice(0, 6));
  return Buffer.concat([c.update(Buffer.from(kind)), c.final()]).toString("hex");
}
console.log("unwind-ok", throwsWithLive("fine"));
try {
  throwsWithLive("boom");
} catch (e) {
  console.log("unwind-throw", (e as Error).message);
}

// ── containers own their payloads: overwrite an element in place ──────
const ring = [createHash("sha256"), createHash("sha512"), createHash("sha1")];
ring[0]!.update("a");
ring[1] = createHash("sha256"); // the sha512 handle dies here
ring[1]!.update("b");
ring[2]!.update("c");
console.log("array", ring.map((x) => x.digest("hex").length).join(","));

const bigs = [1n, 2n, 3n];
bigs[1] = 40n + 2n; // the old 2n dies here
console.log("bigint-array", bigs.map((x) => x.toString()).join(","));

// ── a handle in a record field, overwritten ───────────────────────────
const box: { mac: ReturnType<typeof createHmac>; n: bigint } = {
  mac: createHmac("sha256", "one"),
  n: 7n,
};
box.mac.update("x");
box.mac = createHmac("sha256", "two"); // the "one" handle dies here
box.n = box.n * 6n; // the 7n dies here
box.mac.update("y");
console.log("record", box.mac.digest("hex").slice(0, 12), box.n.toString());

// ── captured in a closure, called more than once ──────────────────────
function counter(): () => number {
  const cap = createHmac("sha256", "cap"); // owned by the capture box
  let n = 0;
  return () => {
    cap.update("tick"); // the handle survives every call
    n += 1;
    return n;
  };
}
const tick = counter();
console.log("capture", tick(), tick(), tick());

// ── keys and ciphers through the same shapes ──────────────────────────
let k = createSecretKey(Buffer.alloc(32, 1));
k = createSecretKey(KEY); // the first key dies here
const enc = createCipheriv("aes-256-ctr", k, IV);
const ct = Buffer.concat([enc.update(Buffer.from("payload")), enc.final()]);
const dec = createDecipheriv("aes-256-ctr", k, IV);
console.log("cipher", ct.toString("hex"), Buffer.concat([dec.update(ct), dec.final()]).toString("utf8"));

const keyRing = [createSecretKey(Buffer.alloc(32, 8)), createSecretKey(Buffer.alloc(32, 9))];
keyRing[0] = createSecretKey(Buffer.alloc(32, 10)); // the first dies here
console.log("keyring", keyRing.length);

// ── the shape the audit cannot see: a handle never digested at all ────
{
  const orphan = createHash("sha512");
  orphan.update("never read");
  const orphanMac = createHmac("sha512", "k");
  const orphanBig = 99999999999999999999n * 3n;
  void orphan;
  void orphanMac;
  void orphanBig;
}
console.log("orphans dropped");
