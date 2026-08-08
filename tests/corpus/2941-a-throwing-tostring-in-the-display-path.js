// A throwing `toString` reached through the DISPLAY path propagates.
// Every arm below is one spelling of JS's ToString over a value that has
// crossed into `unknown`; each runs the value's own toString, and each
// must therefore be catchable exactly where Node catches it. Before the
// display walkers' call sites ran a pending check the exception stayed in
// the cell: the walker appended the empty string, the `catch` never ran,
// and the program printed a blank line and exited 0.
function thrower(tag) {
  return {
    toString: function () {
      console.log("  ran " + tag);
      throw new TypeError("no string for " + tag);
    },
  };
}
function plain(tag) {
  return {
    toString: function () {
      console.log("  ran " + tag);
      return "<" + tag + ">";
    },
  };
}
function boxed(v) {
  return v;
}
function show(tag, s) {
  console.log(tag + " = " + s);
}

// 1. String(v) — the spelling the report was filed against.
try {
  show("String", String(boxed(thrower("a"))));
} catch (e) {
  show("String", "caught " + e.name + ": " + e.message);
}

// 2. A template literal interpolates through the same walker.
try {
  show("template", `${boxed(thrower("b"))}`);
} catch (e) {
  show("template", "caught " + e.name + ": " + e.message);
}

// 3. So does `+` with a string operand.
try {
  show("concat", "head:" + boxed(thrower("c")) + ":tail");
} catch (e) {
  show("concat", "caught " + e.name + ": " + e.message);
}

// 4. The METHOD spelling always propagated — it is the same user
// function, so the two spellings must agree.
try {
  show("method", boxed(thrower("d")).toString());
} catch (e) {
  show("method", "caught " + e.name + ": " + e.message);
}

// 5. Array.prototype.toString joins the elements, and JS stops at the
// first throw: the SECOND element's toString is user code Node never
// runs, so it must not run here either.
try {
  show("array", String(boxed([thrower("e1"), plain("e2")])));
} catch (e) {
  show("array", "caught " + e.name + ": " + e.message);
}

// 6. A nested array flattens through the same recursion.
try {
  show("nested", String(boxed([[thrower("f")]])));
} catch (e) {
  show("nested", "caught " + e.name + ": " + e.message);
}

// 7. A well-behaved toString still answers, and the elements before the
// throwing one still render.
show("plain", String(boxed(plain("g"))));
show("plain-array", String(boxed([plain("h1"), plain("h2")])));

// 8. The throw escapes an inner function to a catch in its CALLER, the
// way any other exception does.
function render(v) {
  return "[" + String(v) + "]";
}
try {
  show("through-call", render(boxed(thrower("i"))));
} catch (e) {
  show("through-call", "caught " + e.name + ": " + e.message);
}

// 9. And a `finally` still runs on the way out.
try {
  try {
    show("finally", String(boxed(thrower("j"))));
  } finally {
    console.log("  finally ran");
  }
} catch (e) {
  show("finally", "caught " + e.name + ": " + e.message);
}

// 10. The pending exception is CLEARED by the catch: the next display
// call answers normally rather than tripping the check it left behind.
show("after", String(boxed(plain("k"))));
console.log("done");
