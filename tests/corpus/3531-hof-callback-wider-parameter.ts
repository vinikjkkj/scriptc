// An array HOF callback may declare a WIDER parameter than the element.
//
// `items.map(parseOne)` where `parseOne` is `(e: Env | null | undefined) =>
// Meta` and `items` is `Env[]` is ordinary parameter contravariance and tsc
// accepts it. The named-parser-reused-for-a-nullable-single-value shape is
// zapo's `client/newsletter/parse.ts` — one `parseNewsletterMetadata`
// serving both `parse(data?.x)` and `(root?.result ?? []).map(parse)`.
//
// The HOF desugar demanded EXACT parameter equality and reported the
// callback as a value with no static representation. It plainly is not one:
// the SAME function assigned to a variable of the same function type
// compiles and calls (the `held` case below, which passed before this rule
// too). What was missing was routing to coerceToExpected, whose
// funcCoerceAdapter already builds the closure — the loop's signature
// outside, the callback's own inside, each argument converted once per call.
//
// The conversion admitted is an ARM WRAP: the element boxes into the
// callback's union under its tag, the same thing a direct call performs, and
// the payload is the same pointer — so identity and mutation are unchanged
// (asserted below, because a copy here would be a silent wrong answer).

type Env = { id: string; n: number };
type Meta = { jid: string; doubled: number };

function parseOne(envelope: Env | null | undefined): Meta {
    return {
        jid: envelope?.id ?? "<none>",
        doubled: (envelope?.n ?? 0) * 2,
    };
}

const items: Env[] = [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
    { id: "c", n: 3 },
];

// The rule: a by-reference named function with a wider parameter.
console.log(items.map(parseOne).map((m) => m.jid + m.doubled).join(","));

// The same function still serves the single nullable value it was written
// for. One declaration, both uses.
console.log(parseOne(undefined).jid);
console.log(parseOne(null).jid);
console.log(parseOne({ id: "z", n: 9 }).doubled);

// The spelling that compiled BEFORE this rule as well: the function type
// itself maps, so it lives in a variable of exactly that type.
const held: (e: Env | null | undefined) => Meta = parseOne;
console.log(held({ id: "held", n: 4 }).jid);

// An empty receiver still calls nothing.
const none: Env[] = [];
console.log(none.map(parseOne).length);

// IDENTITY. The adapter must hand the callback the array's OWN element, not
// a copy of it: an arm wrap boxes the same pointer under a tag.
const first = items[0]!;
let sawSame = false;
items.forEach((e: Env | null | undefined) => {
    if (e === first) sawSame = true;
});
console.log("identity", sawSame);

// MUTATION through the widened parameter reaches the array.
items.forEach((e: Env | undefined) => {
    if (e !== undefined) e.n = e.n * 10;
});
console.log(items.map((e) => e.n).join(","));

// What this rule does NOT reach, and should not: a callback declared with an
// OPTIONAL parameter (`(e?: Env)`) is a function VALUE with an incomplete
// signature, which has its own fence and its own reason — the completed
// signature is a different ABI, not a conversion of this one. Spelling the
// union out is the working form, and it is the form above.
function spelledOut(e: Env | undefined): string {
    return e === undefined ? "-" : e.id;
}
console.log(items.map(spelledOut).join(","));
