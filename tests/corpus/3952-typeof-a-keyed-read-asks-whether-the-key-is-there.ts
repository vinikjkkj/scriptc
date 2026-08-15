// `typeof node.attrs.k === 'string'` is a PRESENCE TEST, and it has to be
// able to answer "no".
//
// This is zapo's `client/coordinators/WaBotCoordinator.ts:204`, verbatim in
// shape:
//
//     const sectionName = typeof section.attrs.name === 'string'
//         ? section.attrs.name : undefined
//
// The checker types an index-signature read by the signature's VALUE type,
// so `section.attrs.name` is spelled `string`. At that width a MISS has
// nowhere to go: the read aborts with
//
//     TypeError: record has no key 'name' (typed 'string' -- no undefined
//     is representable)
//
// on exactly the input the guard was written to reject. Before this block
// the whole expression fenced instead (SC1090 "typeof expressions on
// statically-typed values"), and the fence was doing real work: it was the
// only thing standing between the program and that abort.
//
// THE CONTROL THAT SETTLES IT, and the reason this is a fix and not merely
// a permission: the BOUND spelling of the identical read already answers
// Node-exactly. The very next lines of the same zapo function are
//
//     const jid = node.attrs.jid
//     if (typeof jid !== 'string' || ...) continue
//
// and they compile today and print "undefined" for an absent key, because
// the DECLARATION's slot carries the undefined arm. So the direct spelling
// was the odd one out, and the fence's own hint -- "bind the value to a
// const first" -- was telling authors to write the spelling that already
// worked. Both spellings are exercised below, side by side, and every row
// asserts they agree with each other AND with Node.
//
// The lowering rung is `recordKeyReadAtUndefinedArm`, which already existed
// and was already offered to `??`'s right operand for the same stated
// reason ("asking whether there is a value at all"). typeof is the purest
// form of that question. Where the rung declines -- a DECLARED field, a
// non-index shape, a read that is already undefined-armed -- nothing here
// changes, and the last section pins that.

interface BinaryNode {
    tag: string;
    attrs: { [k: string]: string };
}

function node(tag: string, attrs: { [k: string]: string }): BinaryNode {
    return { tag, attrs };
}

const sections: BinaryNode[] = [
    node("section", { name: "Bots", id: "1" }),
    node("section", { id: "2" }),
    node("section", {}),
];

// THE ZAPO LINE. Present, absent, and empty-attrs.
console.log("-- direct, the zapo spelling --");
for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const sectionName = typeof section.attrs.name === "string" ? section.attrs.name : undefined;
    console.log(i, sectionName);
}

// THE BOUND SPELLING of the same reads. Must agree row for row.
console.log("-- bound, the spelling the fence recommended --");
for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const raw = section.attrs.name;
    const sectionName = typeof raw === "string" ? raw : undefined;
    console.log(i, sectionName);
}

// The bare value form, not just the comparison: `typeof` as a STRING.
console.log("-- bare typeof as a value --");
for (let i = 0; i < sections.length; i += 1) {
    console.log(i, typeof sections[i].attrs.name, typeof sections[i].attrs.id);
}

// Negated, and in a template -- two other consumers of the same answer.
console.log("-- negated and templated --");
for (let i = 0; i < sections.length; i += 1) {
    const s = sections[i];
    console.log(i, typeof s.attrs.name !== "string", `${typeof s.attrs.name}`);
}

// The zapo `continue` shape from two lines further down the same function.
console.log("-- the continue guard --");
for (let i = 0; i < sections.length; i += 1) {
    const s = sections[i];
    if (typeof s.attrs.name !== "string") {
        console.log(i, "skipped");
        continue;
    }
    console.log(i, "kept", s.attrs.name);
}

// A key WRITTEN with a value, then read: presence is a runtime fact, so a
// key added after construction reads present.
console.log("-- written after construction --");
const late: { [k: string]: string } = {};
console.log("before", typeof late.later);
late.later = "here";
console.log("after", typeof late.later);

// A non-string index signature, so the arm is not accidentally specific to
// `Record<string, string>`.
console.log("-- number-valued index signature --");
const counts: { [k: string]: number } = { a: 1 };
console.log(typeof counts.a, typeof counts.b);
console.log(typeof counts.a === "number", typeof counts.b === "number");

// WHERE THE RUNG DECLINES, and must keep declining. A DECLARED field is
// not an index read: it is always present, its answer is the field's own
// type, and nothing about it is a presence test.
console.log("-- declared fields are unchanged --");
const withFields: { a: string; b: number; c?: string } = { a: "x", b: 2 };
console.log(typeof withFields.a, typeof withFields.b, typeof withFields.c);

// An OPTIONAL declared field already carries the undefined arm, so the
// read was already able to answer a miss and the rung leaves it alone.
const withOpt: { c?: string } = {};
console.log(typeof withOpt.c, typeof withOpt.c === "undefined");

// A HYBRID shape -- declared fields AND an index signature. The declared
// field is always present and answers its own type; the index keys are the
// presence test. Both spellings in one object, so a rung that confused the
// two would print the wrong answer on one of these three.
console.log("-- hybrid: declared field plus index signature --");
const hybrid: { id: string; [k: string]: string } = { id: "x", extra: "y" };
console.log(typeof hybrid.id, typeof hybrid.extra, typeof hybrid.nope);

// UNAFFECTED NEIGHBOURS, here so the block's reach is bounded by a test and
// not only by an argument. A `Record<string, unknown>` read already
// answered a miss (it reads at dyn width and asks the dyn kind table); a
// `Map.get` already answered one (the lib types it `V | undefined`).
// Neither goes through the new rung and both must keep their answers.
console.log("-- neighbours that already answered --");
const unknowns: { [k: string]: unknown } = { a: 1, b: "s", c: null, d: [1] };
console.log(typeof unknowns.a, typeof unknowns.b, typeof unknowns.c, typeof unknowns.d, typeof unknowns.missing);
const sizes = new Map<string, number>();
sizes.set("k", 1);
console.log(typeof sizes.get("k"), typeof sizes.get("z"));

// A nested keyed read: the RECEIVER is itself a keyed read into a record
// of records.
console.log("-- nested --");
const tree: { [k: string]: { [k: string]: string } } = { outer: { inner: "v" } };
console.log(typeof tree.outer.inner, typeof tree.outer.missing);

console.log("done");
