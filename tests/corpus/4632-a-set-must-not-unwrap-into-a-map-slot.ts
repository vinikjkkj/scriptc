// THE COUNTEREXAMPLE THE MAP KIND'S TYPE KEY EXISTS TO ANSWER.
//
// ScrMap carries key_kind, val_kind and three RC hooks, and NOTHING that
// names an IR type. `Map<string, number>` and `Set<string>` emit, byte
// for byte, the SAME constructor call:
//
//     scr_map_new(SCR_MAP_KEY_STR, SCR_MAP_VAL_F64, NULL, NULL, NULL)
//
// (measured: compile two such declarations with --keep-c and read the
// scr_map_new lines). So a SCR_DYN_MAP box holding only a `ScrMap *`
// would have nothing to check: the first cast below would pass the kind
// test, unwrap the Set into the Map slot, and `m.get("k")` would read the
// Set's UNUSED f64 value slot and answer a NUMBER — where Node throws.
// A silent wrong answer, which is worse than the refusal it replaced.
// The box therefore carries the compiler-interned typeKey, exactly as the
// FUNC box carries `sig`, and dynMatch/dynCheck are a strcmp on it.
//
// WHY EACH MISMATCH IS REPORTED AS A BARE "threw" RATHER THAN BY MESSAGE.
// A `as` is erased in Node, so Node does not fail at the CAST — it fails
// at the first use that the wrong type cannot serve, with that use's own
// wording ("m.get is not a function"). scriptc validates at the boundary
// and fails there, with the path-annotated dynCheck wording ("expected
// Map at $, got Set"). Both refuse; the two texts name different sites
// and cannot be made equal without one of them lying about where it
// looked. What this file pins is the part that MUST agree, and the part a
// keyless box would break: the wrong-slot read does not quietly succeed.
// Every use below is chosen to be one the wrong type genuinely cannot
// serve in Node, so "threw" is Node's answer too and not a normalisation
// that hides a divergence.

const s = new Set<string>();
s.add("k");
const u: unknown = s;

// 1. A Set read back as a Map. `get` is the method Map has and Set does
//    not, and it is exactly the read a keyless box would answer with the
//    unused f64 slot.
try {
  const m = u as Map<string, number>;
  console.log("WRONG map-slot succeeded:", m.get("k"));
} catch {
  console.log("map-slot: threw");
}

// 2. The same value read back as what it IS. The key matches, so this
//    must NOT throw — and it must give back the very object, not a copy.
const backAsSet = u as Set<string>;
console.log("set-slot:", backAsSet.size, backAsSet.has("k"), backAsSet === s);

// 3. The mirror: a Map must not unwrap into a Set slot. `add` is the
//    method Set has and Map does not.
const m2 = new Map<string, number>();
m2.set("k", 7);
const u2: unknown = m2;
try {
  const asSet = u2 as Set<string>;
  asSet.add("x");
  console.log("WRONG set-slot succeeded:", asSet.size);
} catch {
  console.log("set-slot-from-map: threw");
}

// 4. Two maps of DIFFERENT element types are distinct too, which is the
//    case the (key_kind, val_kind) pair cannot see for reference values:
//    Map<string,string> and Map<string,Uint8Array> are BOTH
//    SCR_MAP_KEY_STR / SCR_MAP_VAL_REF and differ only in per-shape RC
//    hooks, which are not a type identity. `subarray` is the method a
//    Uint8Array has and a string does not.
const text = new Map<string, string>();
text.set("k", "hi");
const u3: unknown = text;
try {
  const asBytes = u3 as Map<string, Uint8Array>;
  console.log("WRONG bytes-slot succeeded:", asBytes.get("k")!.subarray(0, 1).length);
} catch {
  console.log("bytes-slot-from-text: threw");
}

// 5. And the map that matches still round-trips by identity.
const sameText = u3 as Map<string, string>;
console.log("text-slot:", sameText.size, sameText.get("k"), sameText === text);
