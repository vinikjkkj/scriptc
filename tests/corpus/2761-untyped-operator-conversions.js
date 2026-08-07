// The JS operators over UNTYPED operands run their own specified
// conversions, not a checked cast to number. Every operand here reaches its
// operator through `pick`, an untyped helper that returns one of its own
// parameters — the most ordinary shape in JavaScript, and the one that made
// the whole family observable: with no annotation the checker types the
// result `any`, so both sides of every operator below are checked-dynamic.
//
// Arithmetic and the bitwise six are ToNumber; `+` is ToPrimitive and then
// concatenation as soon as EITHER side is a string; `<`/`<=`/`>`/`>=` are
// the abstract relational comparison, which compares two strings AS strings.
// None of that is a guess, and none of it is a number context, so a checked
// cast to number was wrong for every operand that was not already a number.
// A JavaScript entry on purpose: this whole tier only exists for untyped JS.

function pick(tag, v) {
  return v;
}

function show(label, value) {
  console.log(label + " -> " + typeof value + " " + String(value));
}

// ── ToNumber: arithmetic over every primitive dyn kind ──────────────────
show("2.5 - '3'", pick("a", 2.5) - pick("b", "3"));
show("'10' * '4'", pick("a", "10") * pick("b", "4"));
show("'x' / 2", pick("a", "x") / pick("b", 2));
show("true % 2", pick("a", true) % pick("b", 2));
show("null ** 0", pick("a", null) ** pick("b", 0));
show("undefined - 1", pick("a", undefined) - pick("b", 1));
show("'  12  ' - 0", pick("a", "  12  ") - pick("b", 0));
show("'' - 0", pick("a", "") - pick("b", 0));
show("'0x1f' - 0", pick("a", "0x1f") - pick("b", 0));
show("'1e3' - 0", pick("a", "1e3") - pick("b", 0));
show("'Infinity' - 0", pick("a", "Infinity") - pick("b", 0));
show("'12abc' - 0", pick("a", "12abc") - pick("b", 0));

// ── ToInt32/ToUint32: the bitwise six, whose operands are ToNumber too ──
show("'3' | 0", pick("a", "3") | pick("b", 0));
show("undefined | 0", pick("a", undefined) | pick("b", 0));
show("null | 0", pick("a", null) | pick("b", 0));
show("true & 3", pick("a", true) & pick("b", 3));
show("'7' ^ '2'", pick("a", "7") ^ pick("b", "2"));
show("'1' << '10'", pick("a", "1") << pick("b", "10"));
show("'-8' >> 1", pick("a", "-8") >> pick("b", 1));
show("'-8' >>> 1", pick("a", "-8") >>> pick("b", 1));
show("'4294967296' | 0", pick("a", "4294967296") | pick("b", 0));

// ── `+` is not a number context ─────────────────────────────────────────
show("'a' + 'b'", pick("a", "a") + pick("b", "b"));
show("1 + '2'", pick("a", 1) + pick("b", "2"));
show("'2' + 1", pick("a", "2") + pick("b", 1));
show("1 + 2", pick("a", 1) + pick("b", 2));
show("'' + undefined", pick("a", "") + pick("b", undefined));
show("'' + null", pick("a", "") + pick("b", null));
show("'' + true", pick("a", "") + pick("b", true));
show("'' + 2.5", pick("a", "") + pick("b", 2.5));
show("null + 1", pick("a", null) + pick("b", 1));
show("true + true", pick("a", true) + pick("b", true));
show("undefined + 1", pick("a", undefined) + pick("b", 1));
// A dyn `+` against a STATIC number and a STATIC string: the two mixed
// spellings, which take different lowerings and must still agree with Node.
show("dyn + 1(static)", pick("a", "9") + 1);
show("dyn + 'z'(static)", pick("a", 9) + "z");

// ── the abstract relational comparison ──────────────────────────────────
show("'a' < 'b'", pick("a", "a") < pick("b", "b"));
show("'b' < 'a'", pick("a", "b") < pick("b", "a"));
show("'10' < '9'", pick("a", "10") < pick("b", "9"));
show("'10' < 9", pick("a", "10") < pick("b", 9));
show("'abc' <= 'abc'", pick("a", "abc") <= pick("b", "abc"));
show("'x' > null", pick("a", "x") > pick("b", null));
show("undefined < 1", pick("a", undefined) < pick("b", 1));
show("undefined >= 1", pick("a", undefined) >= pick("b", 1));
show("null <= 0", pick("a", null) <= pick("b", 0));
show("true > false", pick("a", true) > pick("b", false));
show("'2' >= 2", pick("a", "2") >= pick("b", 2));

// ── unary: -, +, ~ are all ToNumber ─────────────────────────────────────
show("-'3'", -pick("a", "3"));
show("-undefined", -pick("a", undefined));
show("+'2.5'", +pick("a", "2.5"));
show("+false", +pick("a", false));
show("~'3'", ~pick("a", "3"));
show("~undefined", ~pick("a", undefined));
show("Number(dyn '42')", Number(pick("a", "42")));
show("Number(dyn null)", Number(pick("a", null)));
show("Number(dyn undefined)", Number(pick("a", undefined)));

// ── ++/-- are ToNumeric on the read: no string arm at all ───────────────
var n = pick("a", "3");
n++;
show("'3'++", n);
var m = pick("a", true);
m--;
show("true--", m);

// ── compound assignment: `+=` keeps `+`'s string arm, the rest ToNumber ─
var s = pick("a", "count: ");
s += pick("b", 7);
show("'count: ' += 7", s);
var t = pick("a", "10");
t -= pick("b", "4");
show("'10' -= '4'", t);
var u = pick("a", "6");
u |= pick("b", 0);
show("'6' |= 0", u);
var w = pick("a", 1);
w += pick("b", "!");
show("1 += '!'", w);

// ── ORDER and single evaluation: the conversions must not re-run an
// operand or reorder two of them.
var log = "";
function eff(tag, v) {
  log += tag;
  return v;
}
var sum = eff("1", "2") + eff("2", "3");
console.log("order", log, sum, typeof sum);
log = "";
var cmp = eff("1", "10") < eff("2", "9");
console.log("order", log, cmp);
