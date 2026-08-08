// A RegExp crossing into the checked-dynamic tree and back. The value is
// an immutable (pattern, flags) pair, so it boxes BY REFERENCE like the
// I/O handles: the value survives the round trip unchanged, and the
// members with a complete static lowering answer the same through a
// dynamic receiver as they do statically. What is NOT asserted anywhere
// below is '===' — see the note further down.
//
// The shape comes from protobufjs's util module, which is written as
// `util.key32Re = /^-?(?:0|[1-9][0-9]*)$/` onto an untyped namespace
// object and read back as `util.key32Re.test(key)` — a keyed WRITE of a
// regex onto a dynamic receiver, then a member CALL on the keyed read.
const key32Re = /^-?(?:0|[1-9][0-9]*)$/;
const key2Re = /^(?:true|false|0|1)$/;
const named = /(?<head>[a-z]+)-(?<tail>[0-9]+)/i;

function sink(u: unknown): unknown {
  return u;
}

// in: a typed regex into an 'unknown' slot; out: back by a checked cast.
const boxed = sink(key32Re);
const back = boxed as RegExp;
console.log("source", back.source);
console.log("flags", JSON.stringify(back.flags));
console.log("test", back.test("42"), back.test("-7"), back.test("007"), back.test("x"));

const dboxed = sink(named) as RegExp;
console.log("named flags", JSON.stringify(dboxed.flags));
console.log("named test", dboxed.test("Ab-19"), dboxed.test("19-Ab"));

// The protobufjs shape itself: keyed write onto a dynamic receiver, then
// a member call on the keyed read.
const util: any = JSON.parse("{}");
util.key32Re = key32Re;
util.key2Re = key2Re;
util.named = named;
console.log("dyn 32", util.key32Re.test("0"), util.key32Re.test("10"), util.key32Re.test("01"));
console.log("dyn 2", util.key2Re.test("true"), util.key2Re.test("false"), util.key2Re.test("nope"));
console.log("dyn source", util.key32Re.source);
console.log("dyn flags", JSON.stringify(util.named.flags));
// The flag booleans are DERIVED from the flags text, exactly as a static
// read would derive them (the static tier has no lowering for these
// property reads yet, so the dynamic receiver is the only spelling that
// can be checked against Node here).
console.log(
  "dyn bools",
  util.named.global,
  util.named.ignoreCase,
  util.named.multiline,
  util.named.sticky,
  util.named.unicode,
  util.named.dotAll,
);
console.log("dyn toString", util.key2Re.toString());
console.log("dyn String()", String(util.named));

// test() takes ToString of its argument, exactly like the static entry.
console.log("coerce", util.key32Re.test(42 as unknown as string));
console.log("coerce bool", util.key2Re.test(true as unknown as string));

// A regex inside a dyn CONTAINER: the array's element converter boxes it
// by the same rule the bare value uses.
const many: unknown[] = [key32Re, key2Re, named];
console.log("arr len", many.length);
console.log("arr sources", (many[0] as RegExp).source, (many[2] as RegExp).source);
console.log("arr test", (many[1] as RegExp).test("1"));

// One regex boxed TWICE comes back the same VALUE. Identity is not
// asserted with '===': the emitter interns one static per (pattern,
// flags) pair, so two distinct literals share a pointer where JS has two
// objects, and both spellings of the comparison refuse rather than answer
// wrong (SC1043 statically, a catchable throw through the tree). What IS
// observable is that the round trip changes nothing the value can say.
const a = sink(key2Re) as RegExp;
const b = sink(key2Re) as RegExp;
console.log("double box", a.source === b.source, a.test("0"), b.test("0"), a.test("2"));

// A record field typed 'unknown' takes one the same way, shorthand and
// longhand alike.
const re = key32Re;
const longhand: { v: unknown } = { v: key32Re };
const shorthand: { v: unknown } = { v: re };
console.log("field", (longhand.v as RegExp).test("9"), (shorthand.v as RegExp).test("9x"));

// And it survives a round trip through a dyn-returning function.
function pass(u: unknown): unknown {
  return u;
}
console.log("round trip", (pass(pass(named)) as RegExp).source);
console.log("round trip test", (pass(named) as RegExp).test("zz-3"));
