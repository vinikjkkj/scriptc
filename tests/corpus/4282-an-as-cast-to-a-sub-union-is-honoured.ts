// `u as (T | undefined)` — an `as`-cast whose target is a strict SUB-UNION
// of the operand's type.
//
// The single-arm spelling (`u as T`) has been the CHECKED extraction since
// divergence 38 was written, and coerceToExpected already runs the SAME
// bridge one arm wider whenever a union value meets a narrower union SLOT
// (narrowedRetagHelper). The CAST position alone erased — so an erased cast
// handed its consumer the operand's whole union, and a consumer that reads
// the operand's type DIRECTLY, before any coercion can run, saw arms the
// assertion had named away. `??` is that consumer:
//
//   SC1090: '??' on '<the four-arm operand union>' (the non-nullish result
//           is a sub-union; check a discriminant field first)
//
// which was correct for what it was handed and wrong about the program.
// zapo's spelling is `WaMessageCoordinator.ts:421` — the overload
// implementation of `sendReceipt`, transcribed below with its own shapes.
//
// Only SOUND assertions live here: Node is this suite's oracle, and a LYING
// assertion is exactly where the checked extraction diverges from Node on
// purpose (it throws the catchable TypeError instead of smuggling the wrong
// arm onward — the same trade `u as T` has always taken).
//
// CONTROLS that must keep answering identically:
//   - a cast to the SAME union (erasure, nothing stranded)
//   - a cast to a single ARM (the pre-existing checked extraction)
//   - the sub-union cast WITHOUT a `??` behind it (the coercion-site bridge
//     already answered that one)
//   - the same value narrowed by a `typeof` test instead of a cast

type A = { readonly k: "a"; readonly x: number };
type B = { readonly k: "b"; readonly y: number };

// --- the site ---------------------------------------------------------------
function pick(u: A | B | string | undefined): A {
  const r = (u as A | undefined) ?? { k: "a" as const, x: 0 };
  return r;
}
console.log("pick:", pick({ k: "a", x: 7 }).x, pick(undefined).x);

// --- zapo's shape: an overload implementation whose second parameter is the
// union of every overload's second parameter -------------------------------
interface ReceiptOptions {
  readonly type?: string;
  readonly recipient?: string;
  readonly category?: string;
}

function sendReceipt(target: string, ids: string | readonly string[]): string;
function sendReceipt(target: readonly string[], options?: ReceiptOptions): string;
function sendReceipt(
  first: string | readonly string[],
  second?: string | readonly string[] | ReceiptOptions,
): string {
  if (typeof first === "string") {
    const ids = second as string | readonly string[];
    return `one ${first} ${typeof ids === "string" ? ids : ids.join(",")}`;
  }
  const options = (second as ReceiptOptions | undefined) ?? {};
  return `many ${first.join("|")} ${options.type ?? "delivery"}/${options.category ?? "-"}`;
}

console.log(sendReceipt("jid@s", "MSG1"));
console.log(sendReceipt("jid@s", ["MSG1", "MSG2"]));
console.log(sendReceipt(["a@s", "b@s"]));
console.log(sendReceipt(["a@s"], { type: "read" }));
console.log(sendReceipt(["a@s"], { type: "played", category: "peer" }));

// --- CONTROL: a cast to the SAME union — erasure, nothing stranded ----------
function sameUnion(u: A | undefined): string {
  const v = (u as A | undefined) ?? { k: "a" as const, x: -1 };
  return `${v.k}${v.x}`;
}
console.log("same:", sameUnion({ k: "a", x: 3 }), sameUnion(undefined));

// --- CONTROL: a cast to a single ARM — the pre-existing extraction ----------
function oneArm(u: A | B | string): number {
  return (u as A).x;
}
console.log("arm:", oneArm({ k: "a", x: 11 }));

// --- CONTROL: the sub-union cast with NO `??` behind it ---------------------
// The slot's own coercion has bridged this since narrowedRetagHelper was
// written; the cast position now agrees with it instead of erasing.
function subUnionNoNullish(u: A | B | string | undefined): string {
  const v: A | undefined = u as A | undefined;
  return v === undefined ? "none" : `x=${v.x}`;
}
console.log("nonullish:", subUnionNoNullish({ k: "a", x: 5 }), subUnionNoNullish(undefined));

// --- CONTROL: the same narrowing written as a typeof test -------------------
function byTypeof(u: A | B | string | undefined): string {
  if (u === undefined || typeof u === "string") return "none";
  return u.k === "a" ? `x=${u.x}` : `y=${u.y}`;
}
console.log("typeof:", byTypeof({ k: "a", x: 2 }), byTypeof({ k: "b", y: 4 }), byTypeof("s"), byTypeof(undefined));

// --- FROM THE NODE ORACLE, not from the implementation ----------------------
// Three properties JS guarantees that nothing in the lowering suggests, and
// that a re-tag which COPIED instead of re-wrapping would break silently:
//
//   1. `a ?? b` answers the LEFT VALUE. `(u as A | undefined) ?? d` with a
//      non-nullish `u` is `u` itself — `===` holds and a later write through
//      the result is visible through the original.
//   2. the default is LAZY: it is not evaluated at all when the left is
//      non-nullish.
//   3. `??` triggers on BOTH null and undefined, so a sub-union carrying a
//      `null` arm has to strand and narrow the same way.
type M = { k: "m"; n: number };
const fallbackM: M = { k: "m", n: -1 };
let defaultsTaken = 0;
function makeDefault(): M {
  defaultsTaken += 1;
  return fallbackM;
}
function keptWhole(u: M | B | string | undefined): M {
  return (u as M | undefined) ?? makeDefault();
}
const live: M = { k: "m", n: 1 };
const back = keptWhole(live);
console.log("identity:", back === live, "lazy:", defaultsTaken);
back.n = 42;
console.log("through:", live.n);
const fell = keptWhole(undefined);
console.log("fellback:", fell === fallbackM, "lazy:", defaultsTaken);

// The null arm, and a sub-union that keeps null while dropping others.
function withNull(u: M | B | string | null | undefined): string {
  const r = (u as M | null | undefined) ?? { k: "m" as const, n: 0 };
  return `${r.k}${r.n}`;
}
console.log("null:", withNull({ k: "m", n: 5 }), withNull(null), withNull(undefined));

// --- a sub-union of THREE arms out of five, still sound ---------------------
type C = { readonly k: "c"; readonly z: string };
function three(u: A | B | C | string | undefined): string {
  const v = (u as A | B | undefined) ?? { k: "b" as const, y: 0 };
  return v.k === "a" ? `a${v.x}` : `b${v.y}`;
}
console.log("three:", three({ k: "a", x: 1 }), three({ k: "b", y: 2 }), three(undefined));
