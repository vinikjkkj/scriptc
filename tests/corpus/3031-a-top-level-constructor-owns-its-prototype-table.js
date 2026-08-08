// A TOP-LEVEL constructor function and the own-property table hanging off
// it, with NO dispatch through the prototype anywhere in the program.
//
// 2762 covers the same idiom built by a factory and calls prototype methods
// on the instances. Both of those matter here, because the object underneath
// is a different one and the teardown is a different one:
//
//   * A function referenced as a value at TOP LEVEL is interned into one
//     IMMORTAL closure (rc == SIZE_MAX). Nothing ever refcounts it down, so
//     the props table hung on it — which is where `F.prototype`, `F.k = v`
//     and the lazily-minted prototype object all live — has to be torn down
//     explicitly in main's epilogue or it survives the program.
//   * That teardown used to be emitted only for programs containing a
//     prototype-dispatched call (or Object.defineProperties). This program
//     contains neither: every prototype member it reads is DATA, and every
//     function it calls is a static or a plain function. So it is exactly
//     the shape the teardown skipped, and under the RC audit it has to end
//     with a zero live-heap count, not merely print the right bytes.
//
// Inherited data, own-vs-inherited, shadowing, the own-only operations, a
// member added after instances exist, `instanceof`, and a static that closes
// over the constructor itself — the table holding a reference back into the
// very closure it hangs off.

"use strict";

function Tag(name) {
  this.name = name;
  this.parts = [];
}

// Inherited DATA members. No methods: a prototype-dispatched call is the one
// construct that used to make the exit teardown appear, and this program is
// about the case where it does not.
Tag.prototype.kind = "tag";
Tag.prototype.unit = "px";

// Statics, including one that closes over the constructor.
Tag.create = function (name) {
  return new Tag(name);
};
Tag.label = "Tag";

const t = new Tag("a");
const u = new Tag("b");

console.log(Tag.label, typeof Tag.prototype, typeof Tag.create);
console.log(t.name, u.name, t.kind, u.unit);

// A write shadows on the instance and leaves the prototype alone for the
// other instance still reading it.
t.kind = "shadow";
console.log(t.kind, u.kind);

// Which lookups walk the chain and which are own-only. (Object.keys over an
// instance is 2762's; a dyn-dispatched call is deliberately absent here.)
console.log("kind" in u, Object.hasOwn(u, "kind"), Object.hasOwn(t, "kind"));
console.log(JSON.stringify(u));
console.log(u.missing);

// One prototype object, two spellings; a member added after both instances
// already existed is visible through both.
const proto = Tag.prototype;
proto.late = "late";
console.log(t.late, u.late, Tag.prototype.late);

// The link read back by identity.
console.log(t instanceof Tag, u instanceof Tag, {} instanceof Tag);

// A second top-level constructor whose prototype is never touched at all:
// the epilogue has to cope with a props table that was never allocated.
function Plain(v) {
  this.v = v;
}
console.log(new Plain(7).v, typeof Plain.prototype);
