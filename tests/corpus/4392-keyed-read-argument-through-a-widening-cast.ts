// The ARGUMENT rung's third decliner: an `as` cast between the keyed read
// and the call.
//
// zapo `client/coordinators/WaProfileCoordinator.ts:256`, `:294`, `:295`:
//
//     const pictureId = parseOptionalInt(child.attrs.id as string | undefined)
//     const duration = parseOptionalInt(child.attrs.duration as string | undefined) ?? 0
//
// The callee is `parseOptionalInt`, its parameter IS declared
// `string | undefined`, and the destination census reports `wantArmed=yes`
// at all three — yet the read stayed bare and the process aborted, because
// the rung's syntactic guard looked through parentheses and nothing else.
// The author spelled the undefined arm TWICE, in the cast and in the
// signature, and it still was not enough.
//
// Every expectation below is Node's answer, taken from Node.

type Attrs = Readonly<Record<string, string>>;
const attrs: Attrs = { present: "42", zero: "0", notnum: "x" };

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function show(v: number | undefined): string { return v === undefined ? "undef" : String(v); }
function takeOpt(v: string | undefined): string { return v === undefined ? "undef" : "[" + v + "]"; }

// 1 — the cast on an absent key, the exact zapo spelling.
console.log(show(parseOptionalInt(attrs.pictureId as string | undefined)));
console.log(show(parseOptionalInt(attrs.duration as string | undefined)));

// 2 — the same, present. The cast must not change a hit.
console.log(show(parseOptionalInt(attrs.present as string | undefined)));
console.log(show(parseOptionalInt(attrs.zero as string | undefined)));
console.log(show(parseOptionalInt(attrs.notnum as string | undefined)));

// 3 — the `?? 0` tail zapo writes on two of the three sites.
console.log(String(parseOptionalInt(attrs.duration as string | undefined) ?? 0));
console.log(String(parseOptionalInt(attrs.present as string | undefined) ?? 0));

// 4 — an ELEMENT access under the cast, and a computed key.
console.log(takeOpt(attrs["bracketMiss"] as string | undefined));
const k = "comp" + "uted";
console.log(takeOpt(attrs[k] as string | undefined));
console.log(takeOpt(attrs["present"] as string | undefined));

// 5 — parenthesised cast, and a cast under parentheses: the two orders
//     the guard has to unwrap.
console.log(takeOpt((attrs.parenMiss as string | undefined)));
console.log(takeOpt((attrs.parenMiss2) as string | undefined));

// 6 — `satisfies`, the other spelling of the same wrapper.
console.log(takeOpt(attrs.satMiss satisfies string | undefined));
console.log(takeOpt(attrs.present satisfies string | undefined));

// 7 — a NON-FIRST argument position under a cast.
function pair(a: number, v: string | undefined): string { return String(a) + "/" + takeOpt(v); }
console.log(pair(1, attrs.pairMiss as string | undefined));
console.log(pair(2, attrs.present as string | undefined));

// 8 — the controls. A bare read with no cast (already served), and a cast
//     whose target is the read's OWN type, where the rung has no arm to
//     offer and must leave the program exactly as it was.
console.log(takeOpt(attrs.bareMiss));
console.log(takeOpt(attrs.present));
console.log("as-const:" + takeOpt("lit" as const));
const widened = attrs.present as string;
console.log("plain-cast:" + widened);
