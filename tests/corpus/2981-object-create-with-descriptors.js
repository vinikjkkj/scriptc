// `Object.create(proto, descriptors)` — the two-argument form, which ES
// defines as OrdinaryObjectCreate followed by ObjectDefineProperties.
//
// The reason it matters is one function in protobufjs's minimal runtime,
// reached at module load by every generated codec:
//
//     CustomError.prototype = Object.create(Error.prototype, {
//       constructor: { value: CustomError, writable: true,
//                      enumerable: false, configurable: true },
//       name:        { get: function () { return name; }, set: undefined,
//                      enumerable: false, configurable: true },
//       toString:    { value: function () { … }, writable: true,
//                      enumerable: false, configurable: true } });
//
// Two NON-ENUMERABLE data descriptors and one getter-only accessor. The
// accessor half already had a representation; the data half did not, and
// a plain own member cannot stand in for it — `Object.defineProperty`
// defaults every flag to FALSE, so `{ value: v }` means a property that
// is not in Object.keys, not in JSON, and refuses a write. Storing one
// as an ordinary member answers all three of those questions wrongly and
// says nothing while it does.
//
// So the things that have to hold together:
//
//   1. A `{ value }` descriptor with no flags is non-enumerable AND
//      non-writable: absent from Object.keys / JSON / assign / entries,
//      present to `in` and to Object.hasOwn, and a write to it throws.
//   2. `writable: true` makes the write land — and land IN PLACE, so the
//      key stays out of Object.keys afterwards.
//   3. A method installed by `{ value: fn }` is dispatchable: `o.m()` is
//      Get(o, "m") then Call, so it has to find the same property the
//      keyed read finds, including through the prototype chain.
//   4. `toString` installed that way is found by String() and by `+`.
//   5. `enumerable: true, writable: true` IS an ordinary member and is
//      stored as one — Object.keys reports it.
//   6. Accessors and data descriptors coexist in one map, and neither
//      shows up in the created object's key set unless asked to.
//   7. `Object.create(null, descs)` inherits nothing, so every property
//      it answers came from the map.
//   8. delete and redefinition read `configurable` off the property that
//      is actually there.
//
// The oracle is Node: every line below is compared byte for byte.

// ── 1. The protobufjs idiom, whole ────────────────────────────────────
// (`Error.prototype` is not a value this compiler lowers yet, so the
// base object is a plain one; nothing in the idiom reads through it —
// every member the chain would have offered is shadowed by the map.)
var ERROR_BASE = {};

function newError(name) {
  function CustomError(message, properties) {
    if (!(this instanceof CustomError)) return new CustomError(message, properties);
    Object.defineProperty(this, "message", { get: function () { return message; } });
    if (properties) {
      var ks = Object.keys(properties);
      for (var i = 0; i < ks.length; i++) this[ks[i]] = properties[ks[i]];
    }
  }
  CustomError.prototype = Object.create(ERROR_BASE, {
    constructor: { value: CustomError, writable: true, enumerable: false, configurable: true },
    name: { get: function () { return name; }, set: undefined, enumerable: false, configurable: true },
    toString: {
      value: function () { return this.name + ": " + this.message; },
      writable: true, enumerable: false, configurable: true,
    },
  });
  return CustomError;
}

var ProtocolError = newError("ProtocolError");
var err = ProtocolError("missing required 'os'", { instance: 7 });
console.log("name:", err.name);
console.log("message:", err.message);
console.log("toString():", err.toString());
console.log("String():", String(err));
console.log("concatenated:", "" + err);
console.log("prototype keys:", JSON.stringify(Object.keys(ProtocolError.prototype)));
console.log("instance keys:", JSON.stringify(Object.keys(err)));
console.log("instance JSON:", JSON.stringify(err));
console.log("ctor identity:", ProtocolError.prototype.constructor === ProtocolError);
console.log("instanceof:", err instanceof ProtocolError);
var withNew = new ProtocolError("via new");
console.log("via new:", withNew.toString(), "| keys:", JSON.stringify(Object.keys(withNew)));

// ── 2. A bare `{ value }` descriptor: every flag FALSE ────────────────
var base = {};
var bare = Object.create(base, { locked: { value: "constant" } });
console.log("bare read:", bare.locked);
console.log("bare keys:", JSON.stringify(Object.keys(bare)));
console.log("bare JSON:", JSON.stringify(bare));
console.log("bare assign:", JSON.stringify(Object.assign({}, bare)));
console.log("bare entries:", JSON.stringify(Object.entries(bare)));
console.log("bare in:", "locked" in bare, "| hasOwn:", Object.hasOwn(bare, "locked"));
var lockedKey = "locked";
try {
  bare[lockedKey] = "no";
} catch (e) {
  console.log("write to a non-writable slot:", e.message);
}
console.log("unmoved:", bare.locked);
try {
  delete bare[lockedKey];
} catch (e) {
  console.log("delete of a non-configurable slot:", e.message);
}
console.log("still there:", bare.locked);

// ── 3. writable: true — the write lands, and lands IN PLACE ───────────
var mutable = Object.create(base, { count: { value: 1, writable: true, configurable: true } });
var countKey = "count";
mutable[countKey] = 2;
console.log("after the write:", mutable.count, "| keys:", JSON.stringify(Object.keys(mutable)));
console.log("still hidden from JSON:", JSON.stringify(mutable));
delete mutable[countKey];
console.log("configurable delete:", "count" in mutable, mutable.count);

// ── 4. enumerable: true, writable: true — an ordinary member ──────────
var plainMember = Object.create(base, {
  visible: { value: "yes", writable: true, enumerable: true, configurable: true },
  invisible: { value: "no", writable: true, configurable: true },
});
console.log("mixed keys:", JSON.stringify(Object.keys(plainMember)));
console.log("mixed JSON:", JSON.stringify(plainMember));
console.log("both readable:", plainMember.visible, plainMember.invisible);

// ── 5. Object.create(null, descs) — nothing inherited ─────────────────
var dict = Object.create(null, {
  a: { value: 1, enumerable: true, writable: true },
  b: { value: 2 },
  c: { get: function () { return "computed"; } },
});
console.log("dict.a:", dict.a, "| dict.b:", dict.b, "| dict.c:", dict.c);
console.log("dict keys:", JSON.stringify(Object.keys(dict)));
console.log("dict JSON:", JSON.stringify(dict));
console.log("dict presence:", "b" in dict, "c" in dict, "z" in dict);

// ── 6. A method through the chain, and a getter that sees the receiver ─
var shapeProto = Object.create(base, {
  area: { value: function () { return this.w * this.h; }, writable: true, configurable: true },
  label: { get: function () { return this.w + "x" + this.h; }, configurable: true },
});
function Rect(w, h) { this.w = w; this.h = h; }
Rect.prototype = shapeProto;
var r1 = new Rect(3, 4);
var r2 = new Rect(5, 6);
console.log("areas:", r1.area(), r2.area());
console.log("labels:", r1.label, r2.label);
console.log("rect keys:", JSON.stringify(Object.keys(r1)));
console.log("area is inherited:", Object.hasOwn(r1, "area"), "area" in r1);

// ── 7. Empty and absent descriptor maps ───────────────────────────────
var empty = Object.create(base, {});
console.log("empty keys:", JSON.stringify(Object.keys(empty)), "| proto reachable:", "toStringTagless" in empty);
var noDescs = Object.create(base);
console.log("one-arg still works:", JSON.stringify(Object.keys(noDescs)));

// ── 8. The map's own errors are JS's ──────────────────────────────────
// (through a variable: spelled inline, `{ bad: 5 }` is a CHECKER error —
// "Type 'number' has no properties in common with type
// 'PropertyDescriptor'" — a verdict upstream of anything here.)
var badMap = { bad: 5 };
try {
  Object.create(base, badMap);
} catch (e) {
  console.log("non-object descriptor:", e.message);
}
// (a PRIMITIVE prototype is not spelled here: a statically string-typed
// argument takes the compile-time `Object.create over 'string'
// prototypes` fence, which is the one-argument form's pre-existing
// stance and not a descriptor question. The runtime's own "Object
// prototype may only be an Object or null" still guards the dyn path.)

// ── 9. Redefinition reads the flags that are really there ─────────────
var redef = Object.create(base, {
  swap: { value: "data", writable: true, configurable: true },
});
Object.defineProperty(redef, "swap", { get: function () { return "accessor"; }, configurable: true });
console.log("data -> accessor:", redef.swap, "| keys:", JSON.stringify(Object.keys(redef)));
Object.defineProperty(redef, "swap", { value: "member", writable: true, enumerable: true, configurable: true });
console.log("accessor -> member:", redef.swap, "| keys:", JSON.stringify(Object.keys(redef)));

var sealedTwo = Object.create(base, { fixed: { value: "once" } });
try {
  Object.defineProperty(sealedTwo, "fixed", { value: "twice", writable: true, enumerable: true });
} catch (e) {
  console.log("redefining a sealed slot:", e.message);
}
console.log("unchanged:", sealedTwo.fixed);

// ── 10. An inherited non-writable slot refuses the write too ──────────
var strictProto = Object.create(base, { k: { value: "proto" } });
var child = Object.create(strictProto);
var kKey = "k";
console.log("inherited read:", child.k, "| own:", Object.hasOwn(child, "k"));
try {
  child[kKey] = "shadow";
} catch (e) {
  console.log("write through a non-writable inherited slot:", e.message);
}
// …while a WRITABLE inherited slot is shadowed by a fresh ordinary
// property, which is what JS's OrdinarySet does.
var looseProto = Object.create(base, { w: { value: "proto", writable: true } });
var child2 = Object.create(looseProto);
var wKey = "w";
child2[wKey] = "shadow";
console.log("shadowed:", child2.w, looseProto.w, "| keys:", JSON.stringify(Object.keys(child2)));

// ── 11. Every own-key consumer agrees, by construction ────────────────
// (all four read the member table, which a non-enumerable property never
// enters — so none of them has a filter to remember.)
var mixed = Object.create(base, {
  shown: { value: 1, enumerable: true, writable: true },
  hidden: { value: 2, writable: true, configurable: true },
  got: { get: function () { return 3; }, configurable: true },
});
console.log("inspect:", mixed);
console.log("clone:", JSON.stringify(structuredClone(mixed)));
console.log("assign:", JSON.stringify(Object.assign({}, mixed)));
console.log("reads all three:", mixed.shown, mixed.hidden, mixed.got);

console.log("done");
