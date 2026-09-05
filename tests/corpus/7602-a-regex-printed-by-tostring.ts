// `re.toString()` — the spec's `"/" + source + "/" + flags`, built from the
// two intrinsics that already answer those halves. store-sqlite's table-name
// validator spells it in an error message:
//
//   throw new Error(`tableNames.${t} must match ${PATTERN.toString()}`)
//
// The receiver goes through a lifted one-parameter helper so it is
// evaluated ONCE — the trace below is what would catch a lowering that read
// `source` and `flags` off two separate evaluations of the receiver
// expression.
//
// Flag ORDER in the answer is the spec's canonical order (dgimsuvy), not the
// order the literal was written in, so a regex spelled /x/mig prints /x/gim.

const plain = /^[A-Za-z_][A-Za-z0-9_]*$/;
console.log(plain.toString());

const flagged = /ab+c/gi;
console.log(flagged.toString());

// Canonical flag order, not the written order.
const scrambled = /x/mig;
console.log(scrambled.toString());

// A source with slashes, escapes and a character class.
console.log(/a\/b/.toString());
console.log(/[.*+?^${}()|[\]\\]/g.toString());
console.log(/\d{2,4}/.toString());

// No flags at all, and every single flag on its own.
console.log(/nothing/.toString());
console.log(/g/g.toString());
console.log(/i/i.toString());
console.log(/m/m.toString());
console.log(/s/s.toString());
console.log(/y/y.toString());
console.log(/u/u.toString());

// The empty regex: `source` is the spec's "(?:)", not "".
console.log(new RegExp("").toString());
console.log(new RegExp("").source);

// A runtime-constructed regex answers the same way.
const built = new RegExp("a" + "b+", "g");
console.log(built.toString());
console.log(built.source, built.flags);

// toString agrees with source and flags read separately.
console.log(plain.toString() === "/" + plain.source + "/" + plain.flags);
console.log(flagged.toString() === "/" + flagged.source + "/" + flagged.flags);

// Inside a template literal and a concatenation, the store's shape.
function mustMatch(name: string, re: RegExp): string {
  return `tableNames.${name} must match ${re.toString()}`;
}
console.log(mustMatch("wa_migrations", plain));
console.log("pattern is " + plain.toString() + ".");

// The receiver is evaluated exactly ONCE.
const trace: string[] = [];
function pick(label: string, re: RegExp): RegExp {
  trace.push(label);
  return re;
}
console.log(pick("one", flagged).toString());
console.log(trace.join(","));
console.log(pick("two", /q/y).toString());
console.log(trace.join(","));

// Through a parameter and through an array element.
function show(re: RegExp): string { return re.toString(); }
console.log(show(/param/));
const table: RegExp[] = [/first/, /second/i];
console.log(table[0]!.toString(), table[1]!.toString());

// The result is an ordinary string: length, comparison, and slicing.
const s = flagged.toString();
console.log(s.length, s.charAt(0), s.slice(1, 5), s.indexOf("/", 1));

// The IMPLICIT conversions are the same operation: a template span, an
// explicit String(), and a `+` with a string on the other side. This is the
// spelling store-sqlite's pragma validator uses in the error it throws:
//
//   `invalid pragma value. Allowed token pattern: ${TOKEN_PATTERN}`
const token = /^[A-Za-z0-9_+-]+$/;
console.log(`allowed: ${token}`);
console.log(String(token));
console.log("allowed: " + token);
console.log(token + "");
console.log(`${flagged} and ${plain}`);
console.log(String(new RegExp("z+", "gi")));

// The implicit and explicit spellings agree, on every flag combination.
console.log(`${token}` === token.toString());
console.log(String(flagged) === flagged.toString());
console.log("" + scrambled === scrambled.toString());

// Interpolated into a thrown message, caught and printed.
function assertToken(value: string): void {
  if (!token.test(value)) {
    throw new Error(`invalid value "${value}". Allowed token pattern: ${token}`);
  }
}
try {
  assertToken("ok_value-1");
  console.log("accepted");
  assertToken("no spaces");
  console.log("no throw");
} catch (e) {
  console.log(e instanceof Error ? e.message : String(e));
}

// A regex reached through a parameter, converted implicitly.
function describe(re: RegExp): string { return `pattern=${re}`; }
console.log(describe(plain));
console.log(describe(/tail/gi));
