// The WIDTH a keyed read over an index signature hands out.
//
// `Record<string, readonly string[] | undefined>` declares a two-arm slot,
// and every read of it — `A[k]` — is `string[] | undefined`. That is what
// tsc says and it is what the runtime store can ever hold.
//
// The frontend used to hand out FOUR arms here. The header-family
// canonicalization interns every index-signature shape whose slot carries
// a `string[]` arm — alongside string/number/undefined and nothing else —
// as ONE shape over the canonical outgoing slot
// `number | string | string[] | undefined`, so that a proxy's forwarded
// headers (`{ ...req.headers, host }` into an OutgoingHttpHeaders slot)
// are a plain copy rather than an arm-wise re-tag. The gate asked only
// that the slot CARRY the array arm, so it swept in every
// `Record<string, string[] | undefined>` ever written and widened its
// reads by two arms the program never wrote. Nothing reads a number or a
// bare string out of such a store at runtime, so it was never a wrong
// VALUE — but the TYPE is what the rest of the compiler reasons with, and
// `?.` reasons with it directly: the guard proves "not nullish", what
// survives it at the declared width is ONE arm and at the canonical width
// is THREE, and a three-arm survivor is a sub-union `?.` refuses.
//
// zapo-js 1.8.2's `client/events/privacy.ts:114` is the site —
// `SETTING_VALUES[settingName]?.includes(value) !== true` over a
// `Readonly<Record<string, readonly string[] | undefined>>` — reported as
// SC1090 on `'string[] | number | string | undefined'` while the checker's
// type was `readonly string[] | undefined`. The `?.` rule was never the
// bug.
//
// So the gate now also asks for the `string` ARM, which is what says
// "header world" rather than "some record whose values happen to be string
// arrays": a parsed header value IS a string and the array arm is only the
// repeated-header case. Both halves are pinned below — the narrow slot
// reads at its declared width and chains, and a header-SHAPED slot still
// interns identically with its differently-spelled twin, which is the
// property the canonicalization exists for.

// ── The narrow slot: two arms, and `?.` serves it ────────────────────────

const SETTING_VALUES: Readonly<Record<string, readonly string[] | undefined>> = {
    readReceipts: ["all", "none"],
    lastSeen: ["all", "contacts", "none"],
    online: ["all", "match_last_seen"],
};

function accepts(name: string, value: string): boolean {
    return SETTING_VALUES[name]?.includes(value) === true;
}

console.log(accepts("readReceipts", "all"));
console.log(accepts("readReceipts", "contacts"));
console.log(accepts("lastSeen", "contacts"));
console.log(accepts("nosuchsetting", "all"));

// The same read bound first — this spelling compiled before and must keep
// answering identically, because the two differ only in where the checker's
// type meets the IR's.
function acceptsBound(name: string, value: string): boolean {
    const allowed = SETTING_VALUES[name];
    return allowed !== undefined && allowed.includes(value);
}

console.log(acceptsBound("online", "match_last_seen"));
console.log(acceptsBound("online", "contacts"));

// A MUTABLE narrow slot, filled by keyed writes rather than a literal: the
// store's own miss answer is the undefined arm either way.
const built: Record<string, string[] | undefined> = {};
built["a"] = ["x", "y"];
console.log(built["a"]?.length ?? -1);
console.log(built["b"]?.length ?? -1);
console.log(built["a"]?.[1] ?? "none");

// A number-armed narrow slot: still no `string` arm, so still not the
// header family, and the read is the declared three arms.
const mixed: Record<string, string[] | number | undefined> = { xs: ["p"], n: 4 };
const readMixed = mixed["xs"];
console.log(typeof readMixed === "object" && readMixed !== undefined ? readMixed.join("+") : "not-a-list");
console.log(mixed["n"] === 4);
console.log(mixed["missing"] === undefined);

// ── The header family: a `string` arm, and the shared shape it buys ──────
//
// Two DIFFERENT spellings of the same slot — one with the number arm, one
// without, one with well-known members declared and one bare — must still
// be one shape, so a value crosses between them as itself.

type IncomingLike = {
    readonly host?: string | string[];
    readonly accept?: string | string[];
    readonly [key: string]: string | string[] | undefined;
};

type OutgoingLike = {
    readonly [key: string]: number | string | string[] | undefined;
};

const incoming: IncomingLike = {
    host: "example.test",
    accept: ["text/plain", "text/html"],
    "x-trace": "abc123",
};

function forward(h: IncomingLike): OutgoingLike {
    return h;
}

const out: OutgoingLike = forward(incoming);
console.log(out["host"] === "example.test");
const acceptOut = out["accept"];
console.log(Array.isArray(acceptOut) ? acceptOut.length : -1);
console.log(Object.keys(out).sort().join(","));
console.log(JSON.stringify(incoming));
