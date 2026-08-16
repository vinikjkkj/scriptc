// An array method called through a receiver the checker types
// `readonly unknown[]` — a WIDENING `as` over a real static array — with the
// bare `[]` on the other side of a ternary.
//
// `readonly unknown[]` maps to `dyn` WHOLE (not to an array of dyn), so the
// array dispatch used to see no array at all and the call fell out to the
// generic-method fence. The value is not dynamic: the `as` is erased at run
// time and the receiver lowers to a real `array<string>`, so the ordinary
// tables answer exactly what Node answers.
//
// zapo's spelling is `WaProfileCoordinator.ts:400`, transcribed below with
// its own declared types.
//
// CONTROLS that compiled all along and must keep answering identically:
//   - the same expression with the cast REMOVED
//   - the same expression with the receiver bound to an annotated local first
//   - the same expression with the `[]` arm annotated
//   - a receiver whose value really IS dynamic (keeps the dyn dispatch)

export type WaMexUsernameAvailabilityResponse = {
  readonly xwa2_username_check?: {
    readonly result?: "SUCCESS";
    readonly suggestions?: ReadonlyArray<string>;
  };
};

export interface WaUsernameAvailabilityResult {
  readonly available: boolean;
  readonly suggestions: readonly string[];
}

// --- zapo's function, verbatim in shape -------------------------------------
function parseUsernameAvailabilityMexResponse(
  data: WaMexUsernameAvailabilityResponse | null,
): WaUsernameAvailabilityResult {
  const check = data?.xwa2_username_check;
  const suggestions = (
    Array.isArray(check?.suggestions) ? (check.suggestions as readonly unknown[]) : []
  ).filter((s): s is string => typeof s === "string");
  return { available: check?.result === "SUCCESS", suggestions };
}

const r0 = parseUsernameAvailabilityMexResponse(null);
console.log("null:", r0.available, r0.suggestions.length);

const r1 = parseUsernameAvailabilityMexResponse({});
console.log("empty:", r1.available, r1.suggestions.length);

const r2 = parseUsernameAvailabilityMexResponse({ xwa2_username_check: {} });
console.log("nocheck:", r2.available, r2.suggestions.length);

const r3 = parseUsernameAvailabilityMexResponse({
  xwa2_username_check: { result: "SUCCESS", suggestions: ["alfa", "bravo", "charlie"] },
});
console.log("three:", r3.available, r3.suggestions.join("|"));

const r4 = parseUsernameAvailabilityMexResponse({
  xwa2_username_check: { result: "SUCCESS", suggestions: [] },
});
console.log("emptylist:", r4.available, r4.suggestions.length);

// --- the same shape, one method over -----------------------------------------
function widenedMap(xs: readonly string[], c: boolean): readonly string[] {
  return (c ? (xs as readonly unknown[]) : []).map((s) => String(s).toUpperCase());
}
console.log("map:", widenedMap(["a", "b"], true).join(","), "|", widenedMap(["a", "b"], false).length);

function widenedSome(xs: readonly string[], c: boolean): boolean {
  return (c ? (xs as readonly unknown[]) : []).some((s) => typeof s === "string");
}
console.log("some:", widenedSome(["a"], true), widenedSome(["a"], false));

// --- an INFERRED predicate (no written `is`) ---------------------------------
function widenedInferred(xs: readonly string[], c: boolean): number {
  return (c ? (xs as readonly unknown[]) : []).filter((s) => typeof s === "string").length;
}
console.log("inferred:", widenedInferred(["a", "b"], true), widenedInferred(["a", "b"], false));

// --- CONTROL: the cast removed (compiled before this rule and still does) ----
function noCast(xs: readonly string[], c: boolean): readonly string[] {
  return (c ? xs : []).filter((s): s is string => typeof s === "string");
}
console.log("nocast:", noCast(["a", "b"], true).length, noCast(["a", "b"], false).length);

// --- CONTROL: the receiver bound to an annotated local first -----------------
function boundLocal(xs: readonly string[], c: boolean): number {
  const src: readonly unknown[] = c ? (xs as readonly unknown[]) : [];
  return src.filter((s): s is string => typeof s === "string").length;
}
console.log("boundlocal:", boundLocal(["a", "b", "c"], true), boundLocal(["a"], false));

// --- CONTROL: the `[]` arm annotated -----------------------------------------
function bothArmsAnnotated(xs: readonly string[], c: boolean): number {
  return (c ? (xs as readonly unknown[]) : ([] as readonly unknown[])).filter(
    (s): s is string => typeof s === "string",
  ).length;
}
console.log("bothannot:", bothArmsAnnotated(["a", "b"], true), bothArmsAnnotated(["a"], false));

// --- CONTROL: a receiver whose value really IS dynamic -----------------------
// `readonly unknown[]` all the way down: nothing to adopt, the dyn dispatch
// keeps answering, and the answer is Node's.
function reallyUnknown(xs: readonly unknown[], c: boolean): number {
  return (c ? xs : []).filter((s): s is string => typeof s === "string").length;
}
console.log("reallydyn:", reallyUnknown(["a", 1, "b"], true), reallyUnknown(["a", 1, "b"], false));

// --- evaluate-once: the receiver expression must run exactly once ------------
let effects = 0;
function pick(xs: readonly string[]): readonly string[] {
  effects += 1;
  return xs;
}
const picked = (true ? (pick(["x", "y"]) as readonly unknown[]) : []).filter(
  (s): s is string => typeof s === "string",
);
console.log("effects:", effects, "picked:", picked.join("-"));
