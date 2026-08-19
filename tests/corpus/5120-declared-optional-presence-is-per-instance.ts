// PRESENCE is per INSTANCE, not per DECLARATION — the semantic a `.d.ts`
// cannot carry, and the one a declaration-driven typing of a generated
// protobuf body would have to preserve.
//
// zapo's `spec/proto/index.js` gates every field it writes on
//
//     null != m.x && Object.hasOwnProperty.call(m, "x")
//
// 3,564 times over 641 message types, and its decode DELETES a oneOf's
// siblings through `util.oneOfSetter`
//
//     function (fieldNames) { return function (name) {
//       for (var i = 0; i < fieldNames.length; ++i)
//         if (fieldNames[i] !== name) delete this[fieldNames[i]]; }; }
//
// while the declaration says only `x?: (number|null)`. A declared type
// that made every optional slot PRESENT would put absent fields on the
// wire; one that made a deleted field present again would put a field
// back that the sender removed. Neither is visible in any output but the
// bytes, so this program asserts the distinctions in the four spellings
// a program can ask them in — `in`, `Object.hasOwn`, `Object.keys` and
// `JSON.stringify` — and asserts they AGREE with each other.
//
// (`Object.prototype.hasOwnProperty.call(rec, k)` on a record-typed
// receiver is deliberately absent: it is fenced, and a program is the
// wrong place to assert a refusal. tests/corpus/3713 names that fence.)

interface Msg {
  a?: number;
  b?: number;
  c?: number;
}

function ask(label: string, m: Msg): void {
  // literal keys: `in` with a computed key is fenced (SC1090), so each
  // member is asked by name, which is how a generated codec asks anyway
  const inOp = ("a" in m ? "1" : "0") + ("b" in m ? "1" : "0") + ("c" in m ? "1" : "0");
  const own = (Object.hasOwn(m, "a") ? "1" : "0") + (Object.hasOwn(m, "b") ? "1" : "0") +
    (Object.hasOwn(m, "c") ? "1" : "0");
  // SORTED, because key ORDER is a separate question with its own
  // stance (docs/limitations: a record's keys answer DECLARATION order,
  // not insertion order). This program asks about MEMBERSHIP only, and
  // the two objects built out of declaration order below are the ones
  // that would otherwise smuggle the order question in.
  const keys = Object.keys(m).sort().join("");
  // the same membership, spelled as the `in` string, so all three
  // spellings are compared against each other and not only printed
  const fromKeys = (keys.includes("a") ? "1" : "0") + (keys.includes("b") ? "1" : "0") +
    (keys.includes("c") ? "1" : "0");
  console.log(label + " in=" + inOp + " own=" + own + " keys=" + keys +
    " agree=" + (inOp === own && own === fromKeys ? "yes" : "NO"));
}

// Built with one field, with all three, with none.
ask("one   ", { a: 1 });
ask("all   ", { a: 1, b: 2, c: 3 });
ask("none  ", {});

// An EXPLICIT undefined is a KNOWN divergence and is deliberately not
// asserted here: `{ a: undefined, b: 2 }` has `a` PRESENT in Node and
// ABSENT here — tests/corpus/3713 names it ("the explicit-undefined-is-
// absent divergence"), and a program is the wrong place to re-litigate
// it. Measured on both backends while this program was written:
//   Node    in=110 own=110 keys=ab
//   scriptc in=010 own=010 keys=b
// It matters to the codec question because `null != m.x` and the
// presence test disagree on exactly that value, which is why the
// generated encode asks BOTH.

// Grown after construction.
const grown: Msg = {};
grown.b = 5;
ask("grown ", grown);
grown.a = 6;
ask("grown2", grown);

// DELETED — the oneOf setter's move, and the one that makes a decoded
// message narrower than its own declaration.
const two: Msg = { a: 1, b: 2, c: 3 };
delete two.a;
ask("del-a ", two);
delete two.c;
ask("del-ac", two);
console.log("deleted reads undefined: " + (two.a === undefined) + " " + (two.c === undefined));

// Re-added after deletion: presence comes back, and at the END of the
// key order, exactly where Node puts a re-inserted key.
two.a = 9;
ask("re-add", two);

// A oneOf group, spelled as the generated setter spells it: setting one
// member deletes the others.
function setOneOf(m: Msg, name: string, value: number): void {
  const group = ["a", "b"];
  for (let i = 0; i < group.length; i++) {
    if (group[i] !== name) {
      if (group[i] === "a") delete m.a;
      else delete m.b;
    }
  }
  if (name === "a") m.a = value;
  else m.b = value;
}
const one: Msg = { c: 7 };
setOneOf(one, "a", 1);
ask("oneof1", one);
setOneOf(one, "b", 2);
ask("oneof2", one);

// The gate the generated encode writes, over each of the shapes above:
// what a codec would actually put on the wire.
function wire(m: Msg): string {
  let out = "";
  if (m.a !== undefined && m.a !== null && Object.hasOwn(m, "a")) out += "a" + String(m.a);
  if (m.b !== undefined && m.b !== null && Object.hasOwn(m, "b")) out += "b" + String(m.b);
  if (m.c !== undefined && m.c !== null && Object.hasOwn(m, "c")) out += "c" + String(m.c);
  return out === "" ? "(empty)" : out;
}
console.log("wire one=" + wire({ a: 1 }) + " none=" + wire({}) +
  " del=" + wire(two) + " oneof=" + wire(one));

// JSON, over objects built IN declaration order only, so the answer is
// about presence and not about key order.
console.log("json one=" + JSON.stringify({ a: 1 }) + " none=" + JSON.stringify({}) +
  " all=" + JSON.stringify({ a: 1, b: 2, c: 3 } as Msg));
// (JSON of `two` is deliberately absent: it was built a,b,c, then `a`
// was deleted and re-added, so its key ORDER is the separate documented
// question — Node answers b,a and a record answers declaration order.)

// A record flowing into an interface-typed slot ALIASES: the method and
// the data field are the same object's, so a mutation the method makes
// is the one the field read sees. (A CLASS instance in the same slot
// takes the width-COPY stance instead — docs/limitations, "structural
// width subtyping copies" — which is why this control is a record.)
interface Counter {
  n: number;
  bump(): void;
}
const rec = {
  n: 0,
  bump(): void {
    rec.n = rec.n + 1;
  },
};
function drive(c: Counter): string {
  const before = c.n;
  c.bump();
  c.bump();
  return before + "->" + c.n;
}
console.log("record through an interface: " + drive(rec) + " owner=" + rec.n);
