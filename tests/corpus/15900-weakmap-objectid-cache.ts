// The bson ObjectId cache, shape for shape. bson's objectid.ts keeps a
// module-level `new WeakMap()` (typed WeakMap<WeakKey, any>, values any) and
// reads and writes it from INSTANCE methods with `this` as the key:
//
//   const __idCache = new WeakMap();
//   __idCache.set(this, hexString);
//   __idCache.get(this);
//   __idCache.has(this);
//
// The key is a CLASS INSTANCE, the table's key type is the lib's WeakKey
// (object | symbol), and the value is `any` holding a string or a Uint8Array.
// Node's answer for every line below is the one bson relies on: a per-object
// cache that answers for the object it was written for and for nothing else,
// including an equal-bytes twin.
//
// The lifetime half (an entry dies with its key) is pinned by 15901 under the
// RC audit; this file pins the answers.

const __idCache = new WeakMap();

class ObjectId {
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  toHexString(): string {
    const cached = __idCache.has(this) ? __idCache.get(this) : undefined;
    if (cached !== undefined) return cached;
    let hex = "";
    for (let i = 0; i < this.bytes.length; i++) {
      hex += (this.bytes[i]! < 16 ? "0" : "") + this.bytes[i]!.toString(16);
    }
    __idCache.set(this, hex);
    return hex;
  }

  workingId(): Uint8Array {
    if (__idCache.has(this)) {
      const w = __idCache.get(this);
      if (w instanceof Uint8Array) return w;
    }
    const copy = new Uint8Array(this.bytes);
    __idCache.set(this, copy);
    return copy;
  }

  get id(): Uint8Array {
    return this.bytes;
  }
}

const a = new ObjectId(new Uint8Array([0x65, 0x6e, 0x0a, 0xff]));
const twin = new ObjectId(new Uint8Array([0x65, 0x6e, 0x0a, 0xff]));

console.log("before:", __idCache.has(a), __idCache.has(twin));
console.log("hex a:", a.toHexString());
console.log("hex a again:", a.toHexString());
console.log("after hex:", __idCache.has(a), __idCache.has(twin));
console.log("hex twin:", twin.toHexString());

const wa = a.workingId();
console.log("working len:", wa.length, wa[0], wa[3]);
console.log("working same:", a.workingId() === wa, twin.workingId() === wa);
const cachedWork = __idCache.get(a);
console.log("cached is working:", cachedWork instanceof Uint8Array, cachedWork instanceof Uint8Array ? cachedWork.length : -1);

// The value of a cached hex is a string and the value of a workingId a
// Uint8Array: the get answers the type the set stored.
console.log("typeof hex entry:", typeof __idCache.get(twin));
console.log("missing key:", __idCache.get(new ObjectId(new Uint8Array(1))));
