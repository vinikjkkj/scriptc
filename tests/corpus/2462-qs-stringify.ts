// node:querystring.stringify — Node's encodeStringified value rules
// (scr_qs.c over the dyn crossing): strings escape with the querystring
// set (spaces are %20, never '+'), finite numbers render shortest-
// roundtrip then escape ('1e+21' → '1e%2B21'), non-finite numbers and
// null/undefined are empty VALUES (key and eq still emitted), booleans
// are bare, arrays expand to repeated keys (empty arrays emit nothing at
// all), custom sep/eq apply verbatim with the falsy default rule, and
// keys escape like values. encode is Node's own alias.
import { stringify, encode } from "node:querystring";

console.log("T1", stringify({ a: 1, b: "x y", c: ["1", "2"], d: true, e: "" }));
console.log("T2", stringify({ a: Infinity, b: NaN, c: -0, d: 1e21, e: 0.1, f: -1.5 }));
console.log("T3", stringify({ "a b": "c", "☃": "+", "": "empty", k: "" }));
console.log("T4", JSON.stringify(stringify({})));
console.log("T5", stringify({ a: [] as string[], b: "x" }));
console.log("T6", stringify({ a: ["x", "y"] }, ";", ":"));
console.log("T7", stringify({ a: "1", b: "2" }, "", ""));
console.log("T8", stringify({ u: undefined, n: null, s: "v" } as Record<string, string | null | undefined>));
console.log("T9", stringify({ a: [1, 2.5, true] as (number | boolean)[] }));
console.log("T10", stringify({ "é☃": "é☃ 😀" }));
console.log("T11", stringify({ a: "x" }, "☃", "🌍"));
console.log("T12", encode({ x: [1, 2] }));

// Declared shapes with union-valued fields serialize by the value each
// field HOLDS: a field the value does NOT hold is not a key at all, and a
// null-valued one is a key with the empty value — exactly Node.
//
// NOT asserted, deliberately, and it used to be: `u: undefined` written into
// the same shape. Node keeps the key ("u=&s=v&n="); scriptc answers "absent"
// for it, because `{u?: string}` and `{u: string | undefined}` intern to the
// SAME record shape and a record carries one union tag per field — there is
// no per-instance bit distinguishing "written undefined" from "never
// written", so the two constructions have one representation and the
// converter must answer them the same way. It answers "absent", which is the
// documented stance tests/corpus/3713 names and which the record's own
// Object.keys has always given. The line below is the OTHER construction, the
// common one, and it was WRONG before the presence gate: an omitted `u`
// serialized as "u=&s=v&n=" here too.
const o: { u?: string; s: string; n: number | null } = { s: "v", n: null };
console.log("T13", stringify(o));
const o2: { u?: string; s: string; n: number | null } = { u: "q", s: "v", n: null };
console.log("T13b", stringify(o2));

// Index-signature records (the runtime-keyed build).
const r: Record<string, string | string[]> = {};
r["first"] = "1";
r["multi"] = ["a", "b"];
r["last"] = "z";
console.log("T14", stringify(r));

// The round trip: stringify(parse(qs)) is stable for canonical input.
import { parse } from "node:querystring";
const round = "a=1&a=2&b=x%20y&c=";
console.log("T15", stringify(parse(round)));
