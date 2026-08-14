// An object literal in a UNION slot picks its arm by the discriminant it
// writes — even when a sibling property's CHECKER type is a union the
// lowering resolves to something narrower.
//
// `literalUnionArmOf` is how a literal in a contextual union's slot finds
// the one record arm it inhabits: every written property is matched
// against that arm's checker field type, and exactly one fitting arm wins.
// The match read the SOURCE side as ONE type, so a property whose checker
// type is a UNION was compared whole against the field and fitted only a
// field spelled as that same union.
//
// A nested object literal inside an INSTANTIATED generic body has exactly
// that shape. The checker still answers the SYMBOLIC type there: for
//
//     value: { ...input.value, timestamp: input.timestamp }
//
// with `input.value: ValueForSchema<S>` — a conditional over the type
// parameter — tsc distributes the spread into one arm per branch and types
// the property `{ …picked…; timestamp: number } | { timestamp: number }`,
// while the lowering builds the nested literal at the RESOLVED shape (one
// record). So `operation: 'set'`, a discriminant that names exactly one
// arm of the return union, could not select it; the literal fell back to
// its own inferred type, whose `value` field carried the symbolic union,
// and the nested literal's resolved record then mismatched it. That is
// zapo's `WaAppStateMutationCoordinator.ts:147` — four traps, the largest
// single site in the program, and the diagnostic naming it was over 8 KB
// of `Proto.ISyncActionValue` printed twice.
//
// A source union fits when EVERY arm of it fits. `every`, not `some`: an
// arm with no home would be a value the chosen arm cannot hold. Two
// fitting arms stay ambiguous and still decline.
//
// The bottom of this file pins what did NOT change: the record's OWN-KEY
// ORDER is still the declared one (the documented limitation), and the
// `remove` arm, which never needed the rule, is byte-identical.

interface Long {
    high: number;
    low: number;
    unsigned: boolean;
    toNumber(): number;
}

interface IValue {
    timestamp?: number | Long | null;
    starAction?: { starred?: boolean | null } | null;
    contactAction?: { fullName?: string | null } | null;
}

type CollectionName = "regular" | "regular_high" | "critical_unblock_low";

interface Schema {
    readonly name: string;
    readonly collection: CollectionName;
    readonly version: number;
    readonly valueField: string | null;
}

// The conditional the checker keeps symbolic inside the body below.
type ValueForSchema<S extends Schema> = S["valueField"] extends keyof IValue
    ? Pick<IValue, S["valueField"] & keyof IValue>
    : IValue;

type MutationInput =
    | {
          readonly collection: CollectionName;
          readonly operation: "set";
          readonly index: string;
          readonly value: IValue;
          readonly version: number;
          readonly timestamp: number;
      }
    | {
          readonly collection: CollectionName;
          readonly operation: "remove";
          readonly index: string;
          readonly version: number;
          readonly timestamp: number;
      };

// ------------------------------------------- 1. the zapo shape, verbatim

function buildSetMutationFromSchema<S extends Schema>(input: {
    readonly schema: S;
    readonly value: ValueForSchema<S>;
    readonly timestamp: number;
}): MutationInput {
    return {
        collection: input.schema.collection,
        operation: "set",
        index: `["${input.schema.name}"]`,
        value: { ...input.value, timestamp: input.timestamp },
        version: input.schema.version,
        timestamp: input.timestamp,
    };
}

function buildRemoveMutationFromSchema<S extends Schema>(input: {
    readonly schema: S;
    readonly timestamp: number;
}): MutationInput {
    return {
        collection: input.schema.collection,
        operation: "remove",
        index: `["${input.schema.name}"]`,
        version: input.schema.version,
        timestamp: input.timestamp,
    };
}

const STAR = {
    name: "star",
    collection: "regular_high",
    version: 3,
    valueField: "starAction",
} as unknown as Schema;

const CONTACT = {
    name: "contact",
    collection: "critical_unblock_low",
    version: 5,
    valueField: "contactAction",
} as unknown as Schema;

const PLAIN = {
    name: "plain",
    collection: "regular",
    version: 1,
    valueField: null,
} as unknown as Schema;

function ts(v: number | Long | null | undefined): string {
    if (v === null || v === undefined) return "-";
    if (typeof v === "number") return String(v);
    return `long(${String(v.toNumber())})`;
}

function show(m: MutationInput): string {
    if (m.operation === "set") {
        const sa = m.value.starAction;
        const ca = m.value.contactAction;
        return [
            "set",
            m.collection,
            `v${String(m.version)}`,
            m.index,
            `ts=${String(m.timestamp)}`,
            `star=${sa === null || sa === undefined ? "-" : String(sa.starred)}`,
            `contact=${ca === null || ca === undefined ? "-" : String(ca.fullName)}`,
            `vts=${ts(m.value.timestamp)}`,
        ].join(" ");
    }
    return ["remove", m.collection, `v${String(m.version)}`, m.index, `ts=${String(m.timestamp)}`].join(" ");
}

// Three instantiations, so the resolved element type differs per instance
// exactly as it does in zapo.
console.log(show(buildSetMutationFromSchema({ schema: STAR, value: { starAction: { starred: true } }, timestamp: 1700 })));
console.log(show(buildSetMutationFromSchema({ schema: CONTACT, value: { contactAction: { fullName: "zed" } }, timestamp: 1800 })));
console.log(show(buildSetMutationFromSchema({ schema: PLAIN, value: {}, timestamp: 1900 })));
console.log(show(buildRemoveMutationFromSchema({ schema: STAR, timestamp: 2000 })));

// The override WINS over the spread source's own key, by value.
const carried: IValue = { starAction: { starred: false }, timestamp: 11 };
console.log(show(buildSetMutationFromSchema({ schema: STAR, value: carried, timestamp: 2100 })));
// ...and the source is not mutated by the merge.
console.log("source-kept", ts(carried.timestamp));

// ------------------------------- 2. the arm the literal picks is the one
//                                    the discriminant names, not a wider one

function tagOf(m: MutationInput): string {
    return m.operation;
}
console.log("tag", tagOf(buildSetMutationFromSchema({ schema: STAR, value: {}, timestamp: 1 })));
console.log("tag", tagOf(buildRemoveMutationFromSchema({ schema: STAR, timestamp: 2 })));

// ------------------------------------- 3. OWN-KEY ORDER of the outer arm
//
// The set arm declares collection, operation, index, value, version,
// timestamp and the literal writes them in that same order, so the
// compiled record and JS agree exactly.

function keysOfSet(m: MutationInput): string {
    if (m.operation !== "set") return "-";
    const flat = {
        collection: m.collection,
        operation: m.operation,
        index: m.index,
        version: m.version,
        timestamp: m.timestamp,
    };
    return Object.keys(flat).join(",");
}
console.log("outer-keys", keysOfSet(buildSetMutationFromSchema({ schema: STAR, value: {}, timestamp: 3 })));

// ------------------------------------------------- 4. NOT a goal, pinned
//
// A literal built at a DECLARED shape reports that shape's DECLARATION
// order, not per-object insertion order — the documented limitation, and
// unchanged by this rule. `{ ...v, timestamp: t }` at an `IValue` slot
// therefore lists `timestamp` first where JS lists it last. Both sides of
// the pair are shown here so the next block finds it stated rather than
// rediscovered; every VALUE is identical either way.

interface Flat {
    a?: number;
    b?: number;
}
function declaredOrder(v: Flat, t: number): string {
    const own = { ...v, a: t }; // no contextual type: the literal's OWN order
    return Object.keys(own).join(",");
}
console.log("own-order", declaredOrder({ b: 2 }, 1));

console.log("done");
