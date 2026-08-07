// `Function.prototype.call` / `.apply` over a compiled function value.
//
// These were a LOUD refusal (SC1090, "compiled calls are direct — no
// runtime 'this' or arguments object exists to re-route"), and the claim
// was already false when it was written: `scr_dyn_this_push_dyn` is exactly
// that runtime receiver, the dyn tier had been using it for `.call` and
// `.apply` since it shipped, and `new` binds through it too. What was
// missing was the arm for the COMPILED tier, which is the same bound
// wrapper `.bind` builds -- invoked immediately instead of stored.
//
// The idiom this exists for is ES5 inheritance: the parent constructor's
// `this.x = ...` writes have to land on the CHILD instance, which only
// happens if the receiver re-routes.

function Base(n) { this.n = n; }
Base.prototype.show = function () { return "n=" + this.n; };

function Kid(n, m) {
  Base.call(this, n);
  this.m = m;
}
Kid.prototype = Object.create(Base.prototype);
Kid.prototype.constructor = Kid;

var k = new Kid(1, 2);
console.log(k.n, k.m, k.show());
console.log(k instanceof Kid, k instanceof Base);

// `.apply` with a statically known argument list. A runtime-length pack
// (`fn.apply(this, arguments)`) has no compiled ABI to call through and
// keeps the fence -- this is the arm that lowers.
function Pair(a, b) { this.s = a + "|" + b; }
function Wrap(a, b) { Pair.apply(this, [a, b]); }
Wrap.prototype = Object.create(Pair.prototype);
console.log(new Wrap("x", "y").s);

// The plain forms, on an ordinary function value.
function greet(g) { return g + " " + this.name; }
console.log(greet.call({ name: "c" }, "hey"));
console.log(greet.apply({ name: "a" }, ["yo"]));

// Zero-argument spellings: `.apply` with no list at all, and a target that
// reads only its receiver.
function tag() { return "[" + this.t + "]"; }
console.log(tag.call({ t: "c" }), tag.apply({ t: "a" }));

// Nesting: an inner re-routed call must not disturb the outer one.
function outer() { return this.o + "/" + inner.call({ i: "in" }) + "/" + this.o; }
function inner() { return this.i; }
console.log(outer.call({ o: "out" }));

// `hasOwnProperty.call(o, k)` is by a wide margin the most common
// Function.prototype.call in real JavaScript -- zapo's generated protobuf
// twin spells it 3 564 times -- and it is not a receiver problem at all:
// Object.prototype.hasOwnProperty has no compiled function value, but the
// operation IS Object.hasOwn, which has lowered all along. Recognizing the
// spelling is the whole fix, and it is guarded on the member resolving to
// the LIBRARY declaration, so a receiver that shadows hasOwnProperty with
// its own keeps the fence.
//
// The recognition takes CHECKED-DYNAMIC receivers only. A record receiver
// keeps the fence on purpose: Object.hasOwn's record arm carries the
// documented explicit-undefined-is-absent divergence, and a writer testing
// a field it set to undefined is exactly where inheriting that would be a
// new silent wrong answer.
var bag = { a: 1 };
bag.later = 2;
bag[1] = "num";
console.log(Object.prototype.hasOwnProperty.call(bag, "a"), Object.prototype.hasOwnProperty.call(bag, "later"));
console.log(Object.prototype.hasOwnProperty.call(bag, "z"));
console.log(Object.hasOwnProperty.call(bag, "a"), Object.hasOwnProperty.call(bag, "zz"));
var idx = 1;
console.log(Object.prototype.hasOwnProperty.call(bag, idx));
