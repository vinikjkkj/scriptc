// `JSON.stringify` asks the value for its own JSON first.
//
// SerializeJSONProperty's FIRST step, before the walker looks at what the
// value IS: an object whose `toJSON` is callable runs it, and the RESULT
// is what serializes. The dyn walker (the pure-C lane — no engine) never
// asked, so every object below serialized as its raw members and every
// `toJSON` was dropped as an ordinary function member: `{"a":{}}` where
// Node says `{"a":"key=a"}`.
//
// The subtle half is WHERE the undefined-drop test lives. An object member
// drops when it is absent under stringify, and after this change "absent"
// is decided by what `toJSON` ANSWERED, not by the raw member — so a hook
// returning undefined drops its key, and a hook returning a function drops
// it too, exactly the rule the raw member already obeyed.

function box(v) {
  return v;
}
function show(tag, s) {
  console.log(tag + " = " + s);
}

// 1. The hook replaces the value, and it receives the PROPERTY NAME.
show("member", JSON.stringify(box({ a: { toJSON: (k) => "key=" + k } })));

// 2. In an array the key is the INDEX, as a decimal string.
show(
  "index",
  JSON.stringify(box([{ toJSON: (k) => "idx=" + k }, { toJSON: (k) => "idx=" + k }])),
);

// 3. At the ROOT the key is the empty string.
show("root", JSON.stringify(box({ toJSON: (k) => "root=[" + k + "]" })));

// 4. The hook's RESULT is walked, so its own members get their own hooks.
show(
  "nested",
  JSON.stringify(box({ a: { toJSON: () => ({ b: { toJSON: () => 7 } }) } })),
);

// 5. But the hook runs ONCE per position: the result is not re-hooked, so
// the `toJSON` sitting on it is just a function member and drops.
show("once", JSON.stringify(box({ toJSON: () => ({ toJSON: () => "inner" }) })));

// 6. A `toJSON` that is not callable is an ordinary member and serializes
// as one — data, not a hook.
show("number", JSON.stringify(box({ a: 1, toJSON: 5 })));
show("null", JSON.stringify(box({ a: 1, toJSON: null })));
show("string", JSON.stringify(box({ a: 1, toJSON: "no" })));

// 7. The drop test reads the ANSWER: undefined drops the key in an object
// and prints null in an array slot, and so does a function.
show("drop-obj", JSON.stringify(box({ a: { toJSON: () => undefined }, b: 1 })));
show("drop-arr", JSON.stringify(box([{ toJSON: () => undefined }, 1])));
show("fn-obj", JSON.stringify(box({ a: { toJSON: () => () => 1 }, b: 1 })));
show("fn-arr", JSON.stringify(box([{ toJSON: () => () => 1 }, 1])));

// 8. A ROOT whose hook answers undefined is absent whole — the dyn root's
// documented spelling of Node's undefined VALUE (tsc types the return
// `string`, so no static consumer can tell the two apart; printing it
// spells the same word either way).
show("drop-root", JSON.stringify(box({ toJSON: () => undefined })));

// 9. Every scalar answer round-trips through the hook unchanged.
show(
  "scalars",
  JSON.stringify(
    box({
      n: { toJSON: () => 1.5 },
      s: { toJSON: () => "x" },
      b: { toJSON: () => true },
      z: { toJSON: () => null },
      neg: { toJSON: () => -0 },
      big: { toJSON: () => 1e21 },
      nan: { toJSON: () => NaN },
    }),
  ),
);

// 10. An ARRAY answer keeps the array rules inside it.
show("arr-answer", JSON.stringify(box({ a: { toJSON: () => [1, undefined, 2] } })));

// 11. The hook does not disturb key order — the replaced member keeps its
// own position.
show("order", JSON.stringify(box({ z: 1, a: { toJSON: () => 2 }, m: 3 })));

// 12. Depth: a hook at the bottom of a plain chain still runs.
show("deep", JSON.stringify(box({ l1: { l2: { l3: { toJSON: () => "deep" } } } })));

// 13. Strings from a hook escape exactly like any other JSON string.
show("escape", JSON.stringify(box({ a: { toJSON: () => '"\\\n\t<>' } })));

// 14. A hookless object next to a hooked one is untouched.
show("mixed", JSON.stringify(box({ p: { q: 1 }, r: { toJSON: () => "R" } })));

console.log("done");
