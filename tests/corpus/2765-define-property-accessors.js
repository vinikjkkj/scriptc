// Object.defineProperty over a checked-dynamic value — the ACCESSOR half.
//
// This is the single most common refusal in the zapo artifact (234 of 616
// traps on main's tip), and 233 of those 234 are one shape, the one
// `pbjs --target static-module` emits once per proto3 `optional` field:
//
//     Object.defineProperty(Message.prototype, "_field", {
//       get: util.oneOfGetter(group), set: util.oneOfSetter(group) });
//
// The whole job of that idiom is a property that RUNS a function on read
// and is INVISIBLE to Object.keys — protobufjs's `decode` writes
// `msg._field = "field"` to record which oneof member is present, and
// `Message.create`/`fromObject`/`toObject` all iterate the own keys and
// must not see `_field` among them. Get either half wrong and the wire
// bytes still come out right while the key set does not, which is the
// silent kind of wrong.
//
// So the things that have to hold together:
//
//   1. The accessor lives ONCE on the prototype and every instance's read
//      runs it with `this` bound to that instance — not to the prototype
//      the accessor was found on.
//   2. A plain assignment `inst._x = v` finds the SETTER up the chain and
//      calls it. It does NOT create an own data property (JS's
//      OrdinarySet walks the chain for an accessor before it shadows).
//   3. Object.keys / JSON.stringify / Object.assign / structuredClone do
//      not see the key: an accessor defined without `enumerable: true` is
//      not an own enumerable property.
//   4. `in` DOES see it, and Object.hasOwn does not. Those two disagree
//      here on purpose, exactly as they do in Node.
//   5. A getter-only property refuses the write, with V8's text.
//   6. defineProperty answers the TARGET.
//
// A JavaScript entry on purpose, like the prototype-chain and
// function-own-property fixtures it builds on: the whole route is
// JS-gated, because in TypeScript the checker has a declared member type
// at every one of these accesses.

"use strict";

// protobufjs's util.oneOfGetter / util.oneOfSetter, verbatim in shape:
// the getter scans the instance's OWN keys for whichever member of the
// group is present, and the setter records the winner. (The real setter
// also `delete`s the losers; `delete` in expression position over a
// dynamic receiver is a separate refusal and not this fixture's subject,
// so the losers are cleared by assignment here instead.)
/** @param {string[]} names */
function oneOfGetter(names) {
  var present = {};
  for (var i = 0; i < names.length; ++i) present[names[i]] = 1;
  return function () {
    var keys = Object.keys(this);
    for (var k = keys.length - 1; k > -1; --k) {
      if (present[keys[k]] === 1 && this[keys[k]] !== undefined && this[keys[k]] !== null) {
        return keys[k];
      }
    }
    return undefined;
  };
}

/** @param {string[]} names */
function oneOfSetter(names) {
  return function (name) {
    for (var i = 0; i < names.length; ++i) {
      if (names[i] !== name) this[names[i]] = undefined;
    }
  };
}

function makeMessage() {
  function Message(props) {
    if (props) {
      var keys = Object.keys(props);
      for (var i = 0; i < keys.length; ++i) this[keys[i]] = props[keys[i]];
    }
  }
  var group = ["text", "image"];
  // The idiom. One define, on the prototype, shared by every instance.
  Object.defineProperty(Message.prototype, "_body", {
    get: oneOfGetter(group),
    set: oneOfSetter(group),
  });
  Message.prototype.describe = function () {
    return this._body + "=" + this[this._body];
  };
  return Message;
}

var Message = makeMessage();

// 1. The getter runs against the INSTANCE, not the prototype. Two
//    instances of one constructor, one accessor, two answers.
var a = new Message({ text: "hello" });
var b = new Message({ image: "cat.png" });
console.log("a._body:", a._body);
console.log("b._body:", b._body);
console.log("dispatch through a prototype method:", a.describe(), "|", b.describe());

// 2. The accessor is INVISIBLE to every own-key consumer, which is the
//    reason the idiom exists at all.
console.log("Object.keys(a):", Object.keys(a).join(","));
console.log("JSON.stringify(b):", JSON.stringify(b));
console.log("Object.assign({}, a):", JSON.stringify(Object.assign({}, a)));
console.log("Object.entries(a):", JSON.stringify(Object.entries(a)));

// 3. …but `in` sees it and hasOwn does not. The two answers differ.
console.log("'_body' in a:", "_body" in a, "| hasOwn:", Object.hasOwn(a, "_body"));
console.log("'text' in a:", "text" in a, "| hasOwn:", Object.hasOwn(a, "text"));
console.log("'_body' in {}:", "_body" in {});

// 4. A write walks the chain to the SETTER. No own `_body` appears
//    afterwards — the key set is unchanged and the getter still answers.
b._body = "image";
console.log("after b._body = 'image' — keys:", Object.keys(b).join(","), "| _body:", b._body);
var c = new Message({ text: "t", image: "i" });
console.log("both present, getter picks the last own key:", c._body);
c._body = "text";
console.log("after the setter cleared the loser:", c._body, "| image is now:", c.image);
console.log("keys after the setter:", Object.keys(c).join(","));

// 5. An accessor directly on a plain object — no prototype involved.
var plain = {};
var hits = 0;
Object.defineProperty(plain, "counted", {
  get: function () {
    hits = hits + 1;
    return hits;
  },
});
console.log("own accessor, three reads:", plain.counted, plain.counted, plain.counted);
console.log("plain keys:", JSON.stringify(Object.keys(plain)), "| JSON:", JSON.stringify(plain));

// 6. Getter-only: the write refuses, with V8's own text, and the value
//    does not move.
var writeKey = "counted";
try {
  plain[writeKey] = 99;
} catch (e) {
  console.log("write to a getter-only property:", e.message);
}
console.log("still counting:", plain.counted);

// 7. A DATA descriptor whose flags say what a dynamic own member already
//    means: writable and enumerable. It is an ordinary property.
var d = {};
console.log("defineProperty answers the target:",
  Object.defineProperty(d, "v", { value: 5, writable: true, enumerable: true }) === d);
d.v = 6;
console.log("data descriptor:", d.v, "| keys:", Object.keys(d).join(","), "| JSON:", JSON.stringify(d));

// 8. Redefining a CONFIGURABLE accessor as a data property: the accessor
//    goes, the slot answers, and the key appears in Object.keys because
//    this descriptor asks for an enumerable one. The two never both
//    answer. (The reverse — an accessor over an existing data member —
//    keeps a loud refusal here: JS would keep the member's enumerability
//    and produce an ENUMERABLE accessor, which this representation cannot
//    report through Object.keys.)
var r = {};
Object.defineProperty(r, "x", { get: function () { return "from the getter"; }, configurable: true });
console.log("as an accessor:", r.x, "| keys:", JSON.stringify(Object.keys(r)));
Object.defineProperty(r, "x", { value: "from the slot", writable: true, enumerable: true, configurable: true });
console.log("as data:", r.x, "| keys:", JSON.stringify(Object.keys(r)));
// (through a computed key: tsc's JS expando inference typed `r.x` from
// the FIRST descriptor it saw, and a getter-only one makes the dot
// spelling read-only to the checker.)
var rk = "x";
r[rk] = "and it is an ordinary member now";
console.log("written through:", r[rk], "| keys:", JSON.stringify(Object.keys(r)));

// …and a second define over a NON-configurable accessor is the TypeError
// JS says it is, not a silent replacement.
var sealed = {};
Object.defineProperty(sealed, "y", { get: function () { return "first"; } });
try {
  Object.defineProperty(sealed, "y", { get: function () { return "second"; } });
} catch (e) {
  console.log("redefining a non-configurable accessor:", e.message);
}
console.log("unchanged:", sealed.y);

// 9. An accessor added to a prototype AFTER instances exist is live for
//    them, because the lookup walks the chain at read time.
function Late() {
  this.n = 3;
}
var late = new Late();
console.log("before the define:", late.doubled, "| in:", "doubled" in late);
Object.defineProperty(Late.prototype, "doubled", {
  get: function () {
    return this.n * 2;
  },
  set: function (v) {
    this.n = v / 2;
  },
});
console.log("after the define:", late.doubled, "| in:", "doubled" in late);
late.doubled = 10;
console.log("through the setter:", late.n, "| keys:", Object.keys(late).join(","));

// 10. An own DATA property shadows a prototype accessor of the same name:
//     the own member is found first and the getter never runs.
var shadow = new Late();
Object.defineProperty(shadow, "doubled", { value: "own", writable: true, enumerable: true, configurable: true });
console.log("own shadows the prototype accessor:", shadow.doubled, "| keys:", Object.keys(shadow).join(","));

console.log("done");
