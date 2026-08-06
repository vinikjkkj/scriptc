// The digest input the CHECKER cannot name. zapo's `feed` takes
// `Uint8Array | readonly Uint8Array[]` and splits it with `Array.isArray`;
// tsc's predicate is `arg is any[]`, and no arm of that union is assignable
// to `any[]` (the array arm is readonly), so inside the true branch the
// reference reads back as `any[]` and `input[i]` as `any` — a type that maps
// to nothing. The VALUE is an ordinary Uint8Array: the guard lowered to the
// union's runtime tag test, and the read rides the array arm behind it.
//
// Every line here must answer Node byte for byte, and the single-chunk calls
// beside the multi-chunk ones are the point: if the guard were folded rather
// than tested, or the wrong arm admitted, one of each pair would differ.
import { createHash, createHmac } from "node:crypto";
import * as crypto from "node:crypto";

type HashInput = Uint8Array | readonly Uint8Array[];
type StrInput = string | readonly string[];

// The materialized-handle form, generic exactly as zapo writes it.
function feed<T extends crypto.Hash>(target: T, input: HashInput): T {
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i += 1) {
      target.update(input[i]);
    }
  } else {
    target.update(input as Uint8Array);
  }
  return target;
}

// The keyed twin.
function feedMac<T extends crypto.Hmac>(target: T, input: HashInput): T {
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i += 1) {
      target.update(input[i]);
    }
  } else {
    target.update(input as Uint8Array);
  }
  return target;
}

// A STRING-chunk union: the value dispatch must pick the string entry, not
// the byte one (Node hashes a string's UTF-8 bytes, a Buffer's own bytes —
// and for these inputs the two would differ).
function feedStr(target: crypto.Hash, input: StrInput): crypto.Hash {
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i += 1) {
      target.update(input[i]);
    }
  } else {
    target.update(input as string);
  }
  return target;
}

// The FUSED chain form (createHash(a).update(d).digest(e) as one expression)
// behind the same guard.
function fused(input: HashInput): string {
  if (Array.isArray(input)) {
    return createHash("md5").update(input[0]).digest("hex");
  }
  return createHash("md5").update(input as Uint8Array).digest("hex");
}

function fusedRaw(input: HashInput): Uint8Array {
  if (Array.isArray(input)) {
    return createHash("sha256").update(input[0]).digest();
  }
  return createHash("sha256").update(input as Uint8Array).digest();
}

const a = new Uint8Array([1, 2, 3]);
const b = new Uint8Array([4, 5]);
const empty = new Uint8Array(0);
const key = new Uint8Array([9, 9, 9, 9]);
const pair: readonly Uint8Array[] = [a, b];

// Each digest twice: once through the ARRAY arm, once through the single
// chunk that spells the same message. Equal outputs prove the loop fed the
// arm's real elements; the pairs above prove the tag test really ran.
console.log(feed(createHash("sha256"), pair).digest("hex"));
console.log(feed(createHash("sha256"), new Uint8Array([1, 2, 3, 4, 5])).digest("hex"));
console.log(feed(createHash("sha1"), [a, b, a]).digest("hex"));
console.log(feed(createHash("sha512"), [a, b, a]).digest("base64"));
console.log(feed(createHash("md5"), [a]).digest("hex"));
console.log(feed(createHash("md5"), a).digest("hex"));

// A raw Buffer digest off the narrowed feed.
console.log(Buffer.from(feed(createHash("sha512"), pair).digest()).toString("hex"));

// Empty arms: an empty chunk list and an empty chunk both hash the empty
// message.
console.log(feed(createHash("sha256"), []).digest("hex"));
console.log(feed(createHash("sha256"), empty).digest("hex"));
console.log(feed(createHash("sha256"), [empty, empty]).digest("hex"));

// Many chunks, crossing the accumulator's growth steps and both block sizes.
const many: Uint8Array[] = [];
for (let i = 0; i < 300; i += 1) many.push(new Uint8Array([97]));
console.log(feed(createHash("sha512"), many).digest("hex"));
console.log(feed(createHash("sha512"), new TextEncoder().encode("a".repeat(300))).digest("hex"));

// Hmac, both arms, and the key-longer-than-block case beside them.
console.log(feedMac(createHmac("sha256", key), pair).digest("hex"));
console.log(feedMac(createHmac("sha256", key), new Uint8Array([1, 2, 3, 4, 5])).digest("hex"));
console.log(feedMac(createHmac("sha512", key), [a, b, a]).digest("hex"));
console.log(feedMac(createHmac("sha1", key), a).digest("base64"));
console.log(Buffer.from(feedMac(createHmac("sha256", key), pair).digest()).toString("hex"));

// String chunks.
console.log(feedStr(createHash("sha1"), ["ab", "cd"]).digest("hex"));
console.log(feedStr(createHash("sha1"), "abcd").digest("hex"));
console.log(feedStr(createHash("sha256"), ["héllo ", "wörld"]).digest("hex"));
console.log(feedStr(createHash("sha256"), "héllo wörld").digest("hex"));

// The fused chain, both arms.
console.log(fused(pair));
console.log(fused(a));
console.log(Buffer.from(fusedRaw(pair)).toString("hex"));
console.log(Buffer.from(fusedRaw(a)).toString("hex"));

// A Buffer riding the Uint8Array arm (Node's Buffer IS a Uint8Array).
const bufs: readonly Uint8Array[] = [Buffer.from("hello ", "utf8"), Buffer.from("world", "utf8")];
console.log(feed(createHash("sha256"), bufs).digest("hex"));
console.log(feed(createHash("sha256"), Buffer.from("hello world", "utf8")).digest("hex"));

// The guard's own answer is observable too — it must be the runtime tag,
// not a folded constant.
function which(input: HashInput): string {
  return Array.isArray(input) ? "list" : "one";
}
console.log(which(pair), which(a), which([]), which(empty));
