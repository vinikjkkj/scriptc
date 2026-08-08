// A `toJSON` that throws is the program's throw.
//
// The hook is user code, so an exception out of it belongs to whoever
// called `JSON.stringify` — Node's `catch` runs and the stringify produces
// no string at all. Before the dyn walker consulted `toJSON` the hook was
// never called, so a program written around a throwing one printed a
// serialized husk (`{"a":{}}`) and the `catch` never ran; now that the
// hook DOES run, its throw has to leave the walk rather than be swallowed
// into the buffer the walk was filling.
//
// Each arm also checks the walk STOPS: a hook after the throwing one is
// user code Node never reaches, so it must not run here either.

function box(v) {
  return v;
}
function thrower(tag) {
  return {
    toJSON: function () {
      console.log("  ran " + tag);
      throw new TypeError("no json for " + tag);
    },
  };
}
function plain(tag) {
  return {
    toJSON: function () {
      console.log("  ran " + tag);
      return "<" + tag + ">";
    },
  };
}
function show(tag, s) {
  console.log(tag + " = " + s);
}

// 1. A throwing hook on a member.
try {
  show("member", JSON.stringify(box({ a: thrower("a") })));
} catch (e) {
  show("member", "caught " + e.name + ": " + e.message);
}

// 2. At the root.
try {
  show("root", JSON.stringify(box(thrower("b"))));
} catch (e) {
  show("root", "caught " + e.name + ": " + e.message);
}

// 3. In an array slot — and the LATER slot's hook must not run.
try {
  show("array", JSON.stringify(box([thrower("c1"), plain("c2")])));
} catch (e) {
  show("array", "caught " + e.name + ": " + e.message);
}

// 4. In an object member — the later member's hook must not run either.
try {
  show("object", JSON.stringify(box({ x: thrower("d1"), y: plain("d2") })));
} catch (e) {
  show("object", "caught " + e.name + ": " + e.message);
}

// 5. Nested deep: the throw climbs out of the whole walk.
try {
  show("deep", JSON.stringify(box({ l1: { l2: [{ l3: thrower("e") }] } })));
} catch (e) {
  show("deep", "caught " + e.name + ": " + e.message);
}

// 6. A hook whose RESULT contains a throwing hook: the second one runs
// (it is a member of the answer) and its throw wins.
try {
  show("in-answer", JSON.stringify(box({ a: { toJSON: () => ({ b: thrower("f") }) } })));
} catch (e) {
  show("in-answer", "caught " + e.name + ": " + e.message);
}

// 7. A thrown non-Error value crosses unchanged.
try {
  show(
    "value",
    JSON.stringify(
      box({
        a: {
          toJSON: () => {
            throw "plain string";
          },
        },
      }),
    ),
  );
} catch (e) {
  show("value", "caught " + e);
}

// 8. `finally` still runs on the way out.
try {
  try {
    show("finally", JSON.stringify(box({ a: thrower("g") })));
  } finally {
    console.log("  finally ran");
  }
} catch (e) {
  show("finally", "caught " + e.name + ": " + e.message);
}

// 9. The catch CLEARS the pending exception: the next stringify answers
// normally rather than tripping the check the throw left behind.
show("after", JSON.stringify(box({ a: plain("h") })));

// 10. The hooks before the throwing one DID run and DID have their answers
// discarded — the stringify produced no string at all, not a partial one.
try {
  show("partial", JSON.stringify(box({ a: plain("i1"), b: thrower("i2") })));
} catch (e) {
  show("partial", "caught " + e.name + ": " + e.message);
}

console.log("done");
