// An interned string literal is an IMMORTAL static: the emitter writes it
// as `static struct { size_t rc; ... } sc_lit_N = { SIZE_MAX, ... }`, and
// both `scr_str_retain` (`if (o && o->rc != SIZE_MAX) o->rc++`) and
// `scr_str_release` (`if (!o || o->rc == SIZE_MAX) return`) are exactly
// no-ops on it. So the emitter binds a strLit into a temp that carries NO
// +1 and that `releaseFrame` writes no release for (Temp.immortal,
// emitter.ts).
//
// That is 90.38% of every `scr_str_release` statement zapo's TU contains
// (247,886 of 274,263) — the plumbing is skipped, but the VALUE must still
// behave exactly as an owned string does at every consumer that could
// possibly care about a count. This file drives all of them, and each one
// prints, so a wrong answer is a differing line and not a silent pass:
//
//   * a literal stored in a container that OUTLIVES the statement, read
//     back after the temp's frame is long gone;
//   * the SAME literal in many slots at once — a real string would need N
//     counts, and a container release would double-free it;
//   * a container holding it dropped, then the literal read again;
//   * a literal returned from a function (ownership leaves the frame);
//   * a literal moved into an object field, a Map key, a Map value, a Set;
//   * a literal captured by a closure that outlives the declaring call;
//   * a literal thrown, caught, and re-read;
//   * a literal in a union slot, narrowed back out;
//   * a local initialised from a literal and then REASSIGNED — the old
//     value's release is the one release that is NOT frame-driven, so it
//     still has to be written;
//   * and, the case the deleted releases actually lived in: an EXCEPTION
//     unwinding through a frame with live literal temps in it. The unwind
//     epilogue is where the emitter re-lists the whole live set, so a
//     literal temp appears there 2.93 times on average.
//
// Under `SCRIPTC_RC_AUDIT=1` this file is also a leak/double-free test: a
// count that went one way and not the other shows up as an audit line.

function makeLabel(): string {
  return "label";
}

/* ---- 1. a literal outliving its statement, and the same one many times ---- */
const bag: string[] = [];
for (let i = 0; i < 5; i++) bag.push("repeated");
bag.push("tail");
console.log(bag.join("|"), bag.length);

/* ---- 2. the container dropped, the literal read again ---- */
let dropped: string[] | null = ["gone", "gone", "gone"];
console.log(dropped[0], dropped.length);
dropped = null;
console.log("gone", "gone".length, "gone" === "gone");

/* ---- 3. ownership leaving the frame ---- */
console.log(makeLabel(), makeLabel().length, makeLabel() + "!");

/* ---- 4. object field, Map key, Map value, Set ---- */
const rec: { k: string; v: string } = { k: "kk", v: "vv" };
console.log(rec.k, rec.v);
const m = new Map<string, string>();
m.set("mk", "mv");
m.set("mk2", "mv");
console.log(m.get("mk"), m.get("mk2"), m.size, m.has("mk"));
const s = new Set<string>();
s.add("sv");
s.add("sv");
console.log(s.size, s.has("sv"));

/* ---- 5. captured by a closure that outlives the call ---- */
function capture(): () => string {
  const held = "captured";
  return () => held + "/" + "inline";
}
const held = capture();
console.log(held(), held());

/* ---- 6. thrown and caught ---- */
function thrower(kind: string): string {
  if (kind === "throw") throw new Error("boom-literal");
  return "no-throw";
}
try {
  thrower("throw");
} catch (e) {
  console.log((e as Error).message, (e as Error).message.length);
}
console.log(thrower("ok"));

/* ---- 7. a union slot, narrowed back out ---- */
let u: string | number = "in-union";
console.log(typeof u, u);
u = 7;
console.log(typeof u, u);
u = "in-union-again";
if (typeof u === "string") console.log(u.toUpperCase(), u.length);

/* ---- 8. a local initialised from a literal and REASSIGNED ---- */
let cell = "first";
console.log(cell);
cell = "second";
console.log(cell);
cell = cell + "-grown";
console.log(cell, cell.length);

/* ---- 9. the unwind path: literal temps live when the exception fires ---- */
function unwind(n: number): string {
  const a = "unwind-a";
  const b = "unwind-b";
  const parts: string[] = [a, b, "unwind-c"];
  // Every call below is fallible, so the emitter guards each one and
  // re-lists a, b, parts and every literal temp in the epilogue.
  parts.push(String(n));
  parts.push("unwind-d");
  if (n === 3) throw new Error("unwind at " + String(n) + " with " + a);
  return parts.join(",") + "/" + b;
}
for (let n = 0; n < 5; n++) {
  try {
    console.log(unwind(n));
  } catch (e) {
    console.log("caught:", (e as Error).message);
  }
}

/* ---- 10. a literal handed straight to a consumer that takes ownership ---- */
const owned: string[] = [];
function give(into: string[], what: string): void {
  into.push(what);
  into.push(what);
}
give(owned, "given");
give(owned, "given");
console.log(owned.join("+"), owned.length);
owned.length = 0;
console.log(owned.length, "given".length);

/* ---- 11. a literal as the sole key of a record read after a GC-ish churn -- */
const churn: Array<{ tag: string }> = [];
for (let i = 0; i < 20; i++) churn.push({ tag: "churn-tag" });
let tags = 0;
for (const c of churn) if (c.tag === "churn-tag") tags++;
console.log(tags, churn[19]!.tag);
churn.length = 0;
console.log("churn-tag".length, churn.length);
