// Hash/Hmac handles travelling through the GENERIC containers — the paths
// that store a type's retain/release entry points as DATA (vAdapters), not
// as a statically-known call: a union arm, a record field, and a Map value.
// 2993 already covers the array element; these are the other three, and
// they are the ones both backends reach through the same adapter table.
// A handle holds only bytes, so none of these containers can ever form a
// cycle through it — the digests below must come out identical whichever
// backend emitted the program.
import * as crypto from "node:crypto";

// ── a union arm: the tag decides which release the union runs ───────────
// `Hash | null` — the nullish union is the shape the frontend maps for an
// opaque handle, and the ref arm's payload is stored through the adapter
// pair rather than a statically-known release.
function digestOr(v: crypto.Hash | null, fallback: string): string {
  if (v === null) return fallback;
  return v.digest("hex");
}
const absent: crypto.Hash | null = null;
const present: crypto.Hash | null = crypto.createHash("sha256").update("abc");
console.log("union/null", digestOr(absent, "<none>"));
console.log("union/handle", digestOr(present, "<none>"));

// A union REBOUND to the other arm: the old payload releases through the
// stored pointer, and nothing is left owning the dropped handle.
let slot: crypto.Hash | null = crypto.createHash("sha512").update("dropped");
slot = null;
console.log("union/rebound", digestOr(slot, "<cleared>"));

// ── a record field: the shape's emitted release must reach the handle ───
interface Rolling {
  name: string;
  digest: crypto.Hash;
  mac: crypto.Hmac;
}
function makeRolling(name: string, key: string): Rolling {
  return { name, digest: crypto.createHash("sha256"), mac: crypto.createHmac("sha256", key) };
}
const rows: Rolling[] = [makeRolling("a", "k1"), makeRolling("b", "k2")];
for (const row of rows) {
  row.digest.update(row.name);
  row.mac.update(row.name);
}
for (const row of rows) {
  console.log("record", row.name, row.digest.digest("hex"), row.mac.digest("hex"));
}

// (A Map VALUE would be the fourth such container, but the frontend fences
// `Map<string, Hash>` — SC2xxx naming the value type — so there is no
// backend behaviour to pin there. The array element is 2993's.)

// ── a capture box: a closure over a handle keeps it alive ───────────────
function rollingCounter(): () => string {
  const h = crypto.createHash("sha256");
  let n = 0;
  return (): string => {
    n += 1;
    h.update("tick");
    return `${n}:${crypto.createHash("sha256").update(`tick`.repeat(n)).digest("hex").slice(0, 12)}`;
  };
}
const tick = rollingCounter();
console.log("closure", tick(), tick(), tick());
