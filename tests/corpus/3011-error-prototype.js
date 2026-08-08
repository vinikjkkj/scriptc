// `Error.prototype` as a VALUE — the one standard-library prototype
// object this compiler holds by name.
//
// It exists for one statement. protobufjs's minimal runtime builds every
// custom error type its decoders throw with `util.newError`:
//
//     CustomError.prototype = Object.create(Error.prototype, {
//       constructor: { value: CustomError, writable: true,
//                      enumerable: false, configurable: true },
//       name:        { get: function () { return name; }, set: undefined,
//                      enumerable: false, configurable: true },
//       toString:    { value: function () { … }, writable: true,
//                      enumerable: false, configurable: true } });
//
// The descriptor map got its representation when the object model grew
// non-enumerable own properties. This file is the OTHER argument: a
// prototype has to be a real object with a real [[Prototype]] link for
// any of the observations to hold, and `Error.prototype` was not a value
// this compiler had.
//
// What has to hold together:
//
//   1. ONE object per process. `Error.prototype === Error.prototype`, and
//      the identity is what the chain walk and `instanceof` depend on —
//      two reads answering two copies would make every one of them lie.
//   2. Node's own shape: `name` is "Error", `message` is "", `toString`
//      is a function, and ALL THREE are NON-ENUMERABLE own properties,
//      so `Object.keys(Error.prototype)` is `[]` and `in` / hasOwn still
//      see them.
//   3. `Error.prototype` is NOT an Error instance — modern V8 makes it an
//      ordinary object, so `Error.prototype instanceof Error` is false
//      and `util.inspect` of it is `{}`. (tsc types the expression
//      `Error`, which is exactly the trap: reading it as a runtime error
//      struct would answer a COPY with no identity and no link.)
//   4. `Error.prototype.toString()` is ES's: ToString(this.name) and
//      ToString(this.message) joined with ": ", each side dropped when
//      empty — and it reads `this` through the FULL [[Get]], because a
//      descendant's `name` is routinely an accessor (protobufjs's is).
//   5. A descendant delegates LIVE: reads walk up, a write SHADOWS rather
//      than mutating the prototype, and the shadowing member is the only
//      thing `Object.keys` of the descendant reports.
//   6. `x instanceof Error` answers TRUE through the chain. Before this,
//      the only Error a checked-dynamic value could be was one carrying
//      the runtime's own marker; a custom error type built out of
//      `Object.create(Error.prototype, …)` carries no marker and is an
//      Error entirely by delegation.
//   7. The whole `util.newError` idiom, both call forms (`new E(m)` and
//      the receiver-guarded `E(m)`), with `message` a non-enumerable own
//      property of the INSTANCE and `name` inherited from the prototype.
//
// ONE deliberate divergence, refused loudly rather than answered wrongly:
// `Error.prototype.constructor`. Node's is the `Error` constructor, and
// there is no such VALUE in a static build — `new Error(...)` compiles to
// a runtime error object, not a call through a function box — so the
// back-link has nothing to point at. Reading it throws a named
// not-supported-yet error (catchable) instead of answering undefined.
// `"constructor" in e` and `Object.hasOwn(Error.prototype, "constructor")`
// still answer Node's TRUE: the property exists, it is its VALUE that has
// no answer here, and claiming absence would be the silent kind of wrong.
// An explicitly defined one — which is what the protobufjs idiom writes —
// is an ordinary property and answers exactly, as §3 below shows.
//
// Also outside this file, and unchanged: `Error` itself as a value,
// `Error.captureStackTrace`, and the SUBCLASS prototypes
// (`TypeError.prototype` and friends) all keep their SC2020 fences, and
// `Object.getPrototypeOf` has no lowering, so the prototype LINK is
// checked through delegation rather than by reading it back.

// ── 1. the object itself ──────────────────────────────────────────────

console.log("[1] typeof", typeof Error.prototype);
console.log("[1] identity", Error.prototype === Error.prototype);
console.log("[1] name", Error.prototype.name);
console.log("[1] message", JSON.stringify(Error.prototype.message));
console.log("[1] typeof toString", typeof Error.prototype.toString);
console.log("[1] keys", JSON.stringify(Object.keys(Error.prototype)));
console.log("[1] toString()", Error.prototype.toString());
console.log("[1] String()", String(Error.prototype));
console.log("[1] instanceof Error", Error.prototype instanceof Error);
console.log(
  "[1] in",
  "name" in Error.prototype,
  "message" in Error.prototype,
  "toString" in Error.prototype,
  "constructor" in Error.prototype,
  "nope" in Error.prototype,
);
console.log(
  "[1] hasOwn",
  Object.prototype.hasOwnProperty.call(Error.prototype, "name"),
  Object.prototype.hasOwnProperty.call(Error.prototype, "message"),
  Object.prototype.hasOwnProperty.call(Error.prototype, "constructor"),
  Object.prototype.hasOwnProperty.call(Error.prototype, "nope"),
);

// A binding takes the object, not a copy of it. tsc infers `Error` for
// this variable from its initializer; the value is the checked-dynamic
// singleton, and every read below has to go to the SAME node.
var P = Error.prototype;
console.log("[1] bound identity", P === Error.prototype, P.name, JSON.stringify(P.message));

// ── 2. delegation, shadowing, and toString's two empty cases ──────────

var d = Object.create(Error.prototype);
console.log("[2] fresh keys", JSON.stringify(Object.keys(d)), "own name", Object.prototype.hasOwnProperty.call(d, "name"));
console.log("[2] inherited", d.name, JSON.stringify(d.message), d.toString());
console.log("[2] instanceof Error", d instanceof Error);
d.message = "kaboom";
console.log("[2] after write", d.toString(), JSON.stringify(Object.keys(d)));
console.log("[2] prototype untouched", JSON.stringify(Error.prototype.message), Error.prototype.toString());
console.log("[2] own message now", Object.prototype.hasOwnProperty.call(d, "message"));

// toString drops the separator when either side is empty: "" + msg is
// the message alone, name + "" is the name alone.
var noName = Object.create(Error.prototype);
noName.name = "";
noName.message = "bare message";
console.log("[2] empty name", JSON.stringify(noName.toString()));
var noMsg = Object.create(Error.prototype);
noMsg.name = "Bang";
console.log("[2] empty message", JSON.stringify(noMsg.toString()));

// Non-string members coerce: ES calls ToString on both halves.
var coerced = Object.create(Error.prototype);
coerced.name = 7;
coerced.message = 42;
console.log("[2] coerced", JSON.stringify(coerced.toString()));

// ── 3. protobufjs's util.newError, whole ──────────────────────────────

function newError(name) {
  function CustomError(message) {
    if (!(this instanceof CustomError)) return new CustomError(message);
    // The instance's own `message`: NON-ENUMERABLE, so it never reaches
    // Object.keys or JSON, and still answers the keyed read and the
    // inherited toString.
    Object.defineProperty(this, "message", { value: message });
  }
  CustomError.prototype = Object.create(Error.prototype, {
    constructor: { value: CustomError, writable: true, enumerable: false, configurable: true },
    name: { get: function () { return name; }, set: undefined, enumerable: false, configurable: true },
    toString: { value: function () { return this.name + ": " + this.message; }, writable: true, enumerable: false, configurable: true },
  });
  return CustomError;
}

var ProtocolError = newError("ProtocolError");
var e = new ProtocolError("illegal wire type");
console.log("[3] name", e.name, "| message", e.message);
console.log("[3] toString", e.toString(), "| String", String(e));
console.log("[3] keys(e)", JSON.stringify(Object.keys(e)), "| keys(proto)", JSON.stringify(Object.keys(ProtocolError.prototype)));
console.log("[3] own message", Object.prototype.hasOwnProperty.call(e, "message"), "| own name", Object.prototype.hasOwnProperty.call(e, "name"));
console.log("[3] in", "name" in e, "message" in e, "constructor" in e);
console.log("[3] instanceof own", e instanceof ProtocolError, "| instanceof Error", e instanceof Error);
console.log("[3] constructor is the type", e.constructor === ProtocolError);
console.log("[3] prototype instanceof Error", ProtocolError.prototype instanceof Error);
console.log("[3] JSON", JSON.stringify(e));

// The receiver-guarded call form: `ProtocolError(m)` without `new` builds
// the same object, because the guard re-enters through `new`.
var e2 = ProtocolError("no new");
console.log("[3] guarded", e2.name, e2.message, e2 instanceof ProtocolError, e2 instanceof Error);

// Two types off the same prototype are independent, and each one's
// `name` getter closes over its own argument.
var RangeIssue = newError("RangeIssue");
var r = new RangeIssue("index 9 out of range");
console.log("[3] second type", r.toString(), r instanceof RangeIssue, r instanceof ProtocolError, r instanceof Error);

// ── 4. what is NOT an Error ───────────────────────────────────────────

// The chain test is IDENTITY, not shape: an object that merely looks like
// an error is not one.
var lookalike = { name: "Error", message: "", toString: function () { return "Error"; } };
console.log("[4] lookalike", lookalike instanceof Error, lookalike.toString());
// A two-link chain that never reaches the singleton. (The prototype has
// to be a CHECKED-DYNAMIC object: an object LITERAL passed to
// Object.create maps to a record type and keeps the pre-existing
// `Object.create over '{ … }' prototypes` fence.)
var otherBase = Object.create(null);
otherBase.name = "NotAnError";
var plain = Object.create(otherBase);
console.log("[4] plain chain", plain instanceof Error, plain.name);
// (A PRIMITIVE left operand is `false` in Node and a CHECKER error here —
// "the left-hand side of an 'instanceof' expression must be of type
// 'any', an object type or a type parameter" — so it is described rather
// than asserted. Pre-existing, and nothing to do with this file.)

// A REAL runtime error still answers true — the runtime's own marker, the
// other half of the same predicate.
try {
  JSON.parse("{oops");
} catch (caught) {
  console.log("[4] caught", caught instanceof Error, caught instanceof SyntaxError);
}

// ── 5. the descendant is an ordinary object everywhere else ───────────

var counted = Object.create(Error.prototype);
counted.a = 1;
counted.b = 2;
console.log("[5] keys", JSON.stringify(Object.keys(counted)));
console.log("[5] values", JSON.stringify(Object.values(counted)));
console.log("[5] json", JSON.stringify(counted));
// A fresh copy carries the OWN members and nothing else — the chain does
// not survive serialization, so the copy is not an Error. (A `{ ...o }`
// SPREAD of a checked-dynamic value is a pre-existing SC1090 fence,
// "spreads and accessors in a dyn object literal"; structuredClone is the
// copy that lowers.)
var copy = structuredClone(counted);
console.log("[5] clone", JSON.stringify(copy), copy instanceof Error, copy.name);
console.log("[5] delete", delete counted.a, JSON.stringify(Object.keys(counted)));

console.log("done");
