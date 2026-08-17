// `matcher.matches.some(...)` — zapo `src/retry/reason.ts:52`, the row that
// costs three stanzas in a paired run against the fake server: it is
// `mapRetryReasonFromError`, so a throw there sends no `<receipt type=retry>`,
// no `ack class=message error=500` (sendDecryptFailureAck shares the `try`),
// and no delivery receipt for the replay the peer then never makes.
//
// `as const` on a table of object literals gives a `for…of` binding a union
// type, so `matcher.matches` is a union of readonly TUPLE types. Eleven of
// zapo's thirteen are tuples of string literals and two are tuples of a nested
// tuple, so it lowers to `string[] | string[][]`: two array arms with DIFFERENT
// elements, which no single `elem` describes. `lowerArrayMethodCall` declined
// the receiver outright and the call met the stdlib member fence, printing the
// whole union as the surface name.
//
// TWO RUNGS, IN SERIES, and this fixture needs both — closing only the first
// moves the refusal from `.some` on line 52 to `.every` on line 54:
//
//   1. the union receiver itself, answered by a per-arm dispatch;
//   2. `Array.isArray(candidate)` inside the callback. The guard is declared
//      `arg is any[]`; where the non-array arms are LITERAL types tsc cannot
//      discard them, so instead of narrowing to bare `any[]` it returns the
//      union of the per-arm intersections — printed
//      `("adv" | readonly ["b", "e"]) & any[]` but carrying the Union flag.
//      `checkerAnyArray` answered false on that spelling, so the value-narrowing
//      bridge, the HOF parameter binding and the member dispatch all kept an
//      `any` the value never had.
//
// The dispatch COPIES NOTHING. The alternative — widening the receiver to
// `array<string | string[]>` — is an element-wise rebuild per call, the
// disposition `elemRewrapsInto` and `hofCallbackArg` both refuse by name.
//
// The controls at the end are the arming: a union whose arms share an element
// type never needed any of this (it already lowered to one array type), and the
// WIDENED-arm spelling of the isArray guard was already served on main — that
// pair is what named rung 2.

const MATCHERS = [
  { matches: ["no session", "session not found"], code: 1 },
  { matches: ["invalid key id"], code: 2 },
  { matches: [["broadcast", "ephemeral"]], code: 3 },
  { matches: ["adv"], code: 4 },
  { matches: [["status", "revoke", "delay"]], code: 5 },
] as const;

// zapo's shape, verbatim in structure: a union receiver, `.some`, and an
// `Array.isArray` split inside the callback whose true arm calls `.every`.
function mapReason(message: string): number | undefined {
  for (const matcher of MATCHERS) {
    if (
      matcher.matches.some((candidate) =>
        Array.isArray(candidate)
          ? candidate.every((part) => message.includes(part))
          : message.includes(candidate as string),
      )
    ) {
      return matcher.code;
    }
  }
  return undefined;
}

function show(v: number | undefined): string {
  return v === undefined ? "none" : "code:" + String(v);
}

console.log("== the zapo predicate ==");
// A string arm hits.
console.log("1 no session:", show(mapReason("no session")));
console.log("2 second in the same arm:", show(mapReason("bad: session not found")));
// A nested-tuple arm hits only when EVERY part is present — `.every` inside.
console.log("3 both parts:", show(mapReason("a broadcast ephemeral setting")));
console.log("4 one part only:", show(mapReason("a broadcast setting")));
console.log("5 three parts:", show(mapReason("status revoke delay")));
// Arm order decides: `adv` is code 4 and sits after the nested-tuple arm.
console.log("6 later arm:", show(mapReason("adv failure")));
console.log("7 no match:", show(mapReason("nothing here")));

// ---- `.every` on the union receiver, the other admitted method -------------

const ALL = [{ parts: ["a", "b"] }, { parts: [["a", "b"]] }] as const;

function everyMatches(message: string): string {
  const out: string[] = [];
  for (const row of ALL) {
    out.push(
      String(
        row.parts.every((p) =>
          Array.isArray(p) ? p.every((q) => message.includes(q)) : message.includes(p as string),
        ),
      ),
    );
  }
  return out.join(",");
}

console.log("== every ==");
console.log("8 all present:", everyMatches("a b"));
console.log("9 one missing:", everyMatches("a"));

// ---- controls: what did NOT need the dispatch ------------------------------

// C1 — arms that share an element type collapse to ONE array type before the
// dispatch is ever consulted; this compiled on main and must not move.
const UNIFORM = [
  { matches: ["no session", "session not found"], code: 1 },
  { matches: ["adv"], code: 2 },
] as const;

function uniform(message: string): number | undefined {
  for (const m of UNIFORM) {
    if (m.matches.some((c) => message.includes(c))) return m.code;
  }
  return undefined;
}

// C2 — the isArray guard over WIDENED arms. tsc drops the non-array arms here
// and hands back bare `any[]`, which `checkerAnyArray` always recognised, so
// this compiled on main. It is the twin that isolated rung 2.
const WIDE: readonly (string | readonly string[])[] = ["adv", ["broadcast", "ephemeral"]];

function wide(message: string): boolean {
  return WIDE.some((c) =>
    Array.isArray(c) ? c.every((p) => message.includes(p)) : message.includes(c as string),
  );
}

// C3 — the callback still sees the right element in each arm, so a body that
// reads the element's own members answers per arm rather than fencing on `any`.
function lengths(): string {
  const out: string[] = [];
  for (const matcher of MATCHERS) {
    matcher.matches.some((candidate) => {
      out.push(Array.isArray(candidate) ? "arr" + String(candidate.length) : "str" + String(candidate.length));
      return false;
    });
  }
  return out.join(",");
}

console.log("== controls ==");
console.log("C1 uniform arms:", show(uniform("adv")), show(uniform("no session")), show(uniform("zz")));
console.log("C2 widened arms:", wide("adv"), wide("broadcast ephemeral"), wide("zz"));
console.log("C3 per-arm element:", lengths());
