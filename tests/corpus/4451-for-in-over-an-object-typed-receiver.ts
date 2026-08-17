// `function hasAnyKey(value: object) { for (const _ in value) return true; ... }`
// — a for-in whose receiver's declared type is `object`, the NonPrimitive top
// type.
//
// This is zapo `message/context-info.ts:229-234`, and it is not a small row: on
// a live paired run against the fake server it fires FIVE times, and three of
// the five are the three SEND steps (`send text`, `send text object`,
// `group send`). With it fenced the compiled client reaches 0 of the driver's
// SEND, GROUPSEND, REACTION, QUOTE, POLL, RECEIPTOUT and WIRE stages and sends
// the peer nothing at all.
//
// `object` and `unknown` both map to dyn (types.ts's NonPrimitive and Unknown
// arms), and `lowerForIn` dispatched on record / array / union / class-instance
// and had no dyn arm, so both fell to its last fallback — which prints the
// checker's own type text, "for-in over 'object' receivers". The key set is
// `scr_dyn_obj_keys`, EXACTLY the list `Object.keys` already answers for each
// runtime kind, so admitting it is not a second stance about what a key is.
//
// Every runtime kind the walk can meet is here, because they do not agree:
// an object answers its own enumerable members in JS own-key order (integer-like
// keys ascending FIRST, hence "2,10,b,a" and not "b,a,2,10"), an array and a
// string answer index strings and never `length`, and every scalar answers the
// empty list. NULLISH is the one kind where for-in and Object.keys DISAGREE —
// `Object.keys(null)` throws and `for (const k in null) {}` iterates zero times
// — so it is here twice, once for the key list and once for a loop that must
// simply not run.

function keysOf(v: object): string[] {
  const out: string[] = [];
  for (const k in v) {
    out.push(k);
  }
  return out;
}

function hasAnyKey(v: object): boolean {
  for (const _ in v) {
    return true;
  }
  return false;
}

function show(label: string, v: object): void {
  console.log(label + " [" + keysOf(v).join(",") + "] any=" + String(hasAnyKey(v)));
}

// An object's own keys, in JS own-key order: integer-like ascending, then the
// rest in insertion order.
show("plain", { b: 1, a: 2, 10: "x", 2: "y" });
show("empty", {} as object);
show("nested", { o: { deep: 1 } });

// An array and a string are index-keyed; `length` is non-enumerable in Node and
// must not appear.
show("array", [7, 8, 9] as unknown as object);
show("emptyArray", [] as unknown as object);
show("string", "abc" as unknown as object);

// Scalars have no own enumerable string keys.
show("num", 42 as unknown as object);
show("bool", true as unknown as object);

// The two nullish kinds: legal, and zero iterations, where Object.keys throws.
show("null", null as unknown as object);
show("undefined", undefined as unknown as object);

function countPasses(v: object): number {
  let n = 0;
  for (const _ in v) {
    n += 1;
  }
  return n;
}
console.log(
  "nullish passes " +
    String(countPasses(null as unknown as object)) +
    "," +
    String(countPasses(undefined as unknown as object)),
);

// The binding forms for-in admits, all three of them, because the dyn arm hands
// the shared key-walk helper its list and the helper is what implements them.
function preDeclared(v: object): string {
  let key = "none";
  let acc = "";
  for (key in v) {
    acc += key + ";";
  }
  return acc + "|last=" + key;
}
console.log("preDeclared " + preDeclared({ r: 1, s: 2 }));

function varForm(v: object): string {
  var k = "none";
  var acc = "";
  for (k in v) {
    acc += k + ";";
  }
  return acc + "|k=" + k;
}
console.log("varForm " + varForm({ p: 1, q: 2 }));

// Labelled break and continue bind to the loop, which now sits inside the
// nullish guard's `if` — so this is the test that the guard did not capture them.
function labelled(v: object): string {
  let acc = "";
  outer: for (const k in v) {
    if (k === "skip") continue outer;
    if (k === "stop") break outer;
    acc += k + ";";
  }
  return acc;
}
console.log("labelled " + labelled({ a: 1, skip: 2, b: 3, stop: 4, c: 5 }));

// A nested for-in over two different receivers, so the two hidden receiver
// locals cannot be the same slot.
function pairs(a: object, b: object): string {
  let acc = "";
  for (const x in a) {
    for (const y in b) {
      acc += x + y + ";";
    }
  }
  return acc;
}
console.log("pairs " + pairs({ m: 1, n: 2 }, { u: 1, v: 2 }));

// `unknown` maps to dyn by the same arm, and a JSON.parse result is a dyn that
// came from no converter at all — the receiver shape the per-visit presence
// guard is exact for.
const parsed: unknown = JSON.parse('{"j":1,"k":[1,2],"l":null}');
show("parsed", parsed as object);

// THE SHAPE THE ZAPO SITE IS ACTUALLY CALLED WITH, and the reason the per-visit
// guard tests the VALUE and not only `hasOwn`.
//
// A record reaching an `object` slot converts through `dynFrom`, whose record arm
// publishes every DECLARED slot — so a converted record carries a key for each of
// its optional fields whether the field was omitted or not, because the record
// representation stores the same undefined arm either way. `hasAnyKey` over an
// all-optional record would therefore answer YES always, which is what zapo's
// `buildContextInfo` asks (`hasAnyKey(ctx) ? ctx : null`) before deciding whether
// to attach a contextInfo at all. Skipping undefined-valued keys is what makes
// the OMITTED case right.
//
// The EXPLICIT `{ a: undefined }` case is deliberately absent: Node visits that
// key, this skips it, the record representation cannot tell the two apart, and
// pinning it would pin an answer Node disagrees with.
type Ctx = { a?: number; b?: string; c?: boolean };

const noKeys: Ctx = {};
const oneKey: Ctx = { b: "x" };
const twoKeys: Ctx = { a: 1, c: true };
show("ctx none", noKeys);
show("ctx one", oneKey);
show("ctx two", twoKeys);

// The same question the zapo site asks, spelled the way it spells it.
function buildCtxLike(v: Ctx): string {
  return hasAnyKey(v) ? "attached" : "null";
}
console.log("ctx none -> " + buildCtxLike(noKeys));
console.log("ctx one  -> " + buildCtxLike(oneKey));
console.log("ctx two  -> " + buildCtxLike(twoKeys));

// A required field is not droppable and must survive beside optional ones.
type Mixed = { id: string; opt?: number; flag: boolean };
show("mixed no-opt", { id: "i", flag: true } as Mixed);
show("mixed with-opt", { id: "j", opt: 3, flag: false } as Mixed);
