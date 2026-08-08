// Looking up `toJSON` is a [[Get]], so an INHERITED one counts — and the
// call binds the value as the receiver.
//
// `Date.prototype.toJSON` is the canonical shape of this in Node (Date has
// no representation here, so the pre-class `F.prototype.toJSON = ...`
// spelling stands in for it): the hook lives on the prototype, `this` is
// the instance being serialized, and the one argument is the key the
// instance sits under. An own-property-only lookup would miss all three.

function Stamp(v) {
  this.v = v;
}
Stamp.prototype.toJSON = function (key) {
  return "Stamp(" + this.v + ")@" + key;
};

function Silent() {
  this.hidden = 1;
}
Silent.prototype.toJSON = function () {
  return undefined;
};

function box(v) {
  return v;
}
function show(tag, s) {
  console.log(tag + " = " + s);
}

const s = new Stamp(7);

// 1. As a member: the key is the property name, `this` is the instance.
show("member", JSON.stringify(box({ p: s })));

// 2. In an array: the key is the index.
show("index", JSON.stringify(box([s, new Stamp(8)])));

// 3. At the root: the key is the empty string.
show("root", JSON.stringify(box(s)));

// 4. Two instances of one prototype each see their OWN `this`.
show("two", JSON.stringify(box({ a: new Stamp("a"), b: new Stamp("b") })));

// 5. An OWN `toJSON` shadows the inherited one, like any property.
const shadowed = new Stamp(9);
shadowed.toJSON = function (key) {
  return "own@" + key;
};
show("shadow", JSON.stringify(box({ q: shadowed })));

// 6. An inherited hook answering undefined drops the key, and prints null
// in an array slot — the drop test reads the ANSWER, wherever it came
// from.
show("drop", JSON.stringify(box({ a: new Silent(), b: 1 })));
show("drop-arr", JSON.stringify(box([new Silent(), 1])));

// 7. An instance whose prototype has NO hook serializes its own members,
// unchanged.
function Bare(v) {
  this.v = v;
}
show("bare", JSON.stringify(box({ z: new Bare(3) })));

// 8. Nesting: the instance can sit anywhere in the tree.
show("deep", JSON.stringify(box({ l1: { l2: [{ l3: s }] } })));

console.log("done");
