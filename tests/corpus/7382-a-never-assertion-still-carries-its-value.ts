// THE EXHAUSTIVENESS IDIOM, and the reason it is a correctness case rather
// than a convenience one.
//
// `const _exhaustive: never = discriminant` in a switch's default arm is how
// strict TypeScript asserts the arms are complete. The never mapping's own
// comment said construction sites for never "cannot exist (nothing has type
// never to feed them)"; this is the site, and it is everywhere - the
// messaging bench's _store-factory.ts:91 is one.
//
// The value is NOT unobservable. Every `never` assertion admits an unsound
// cast at the call site, and when one arrives the default arm RUNS and Node
// interpolates the REAL value into whatever the next line builds. So the
// binding has to carry it. Held in the f64 slot the never mapping hands out,
// a string discriminant fenced SC1090 ("'string' values where 'number' is
// expected") and every use inherited SC2004; carrying the value but dropping
// it would be worse - `unreachable: undefined` where Node says
// `unreachable: bogus`, at exit 0, with nothing said.
//
// Numeric discriminants already worked by accident (the number fits the f64
// slot), so the numeric cases below are the CONTROL: they must not move.

type Backend = "memory" | "sqlite" | "postgres";

function describe(backend: Backend): string {
  switch (backend) {
    case "memory":
      return "mem";
    case "sqlite":
      return "sq";
    case "postgres":
      return "pg";
    default: {
      // Read TWICE on purpose: a one-shot lowering would differ on the second.
      const _exhaustive: never = backend;
      return `unreachable: ${_exhaustive as string}|${_exhaustive as string}`;
    }
  }
}

type NumKind = 1 | 2;
function describeNum(k: NumKind): string {
  switch (k) {
    case 1:
      return "one";
    case 2:
      return "two";
    default: {
      const _n: never = k;
      return `num: ${_n as number} ${typeof (_n as number)}`;
    }
  }
}

interface Shaped {
  tag: "a" | "b";
}
function describeShape(s: Shaped): string {
  switch (s.tag) {
    case "a":
      return "A";
    case "b":
      return "B";
    default: {
      const _s: never = s.tag;
      return `shape: ${String(_s as string)} / ${JSON.stringify(_s as string)}`;
    }
  }
}

// The binding read from inside a CLOSURE created in the same arm.
function closureCase(backend: Backend): string {
  switch (backend) {
    case "memory":
    case "sqlite":
    case "postgres":
      return "known";
    default: {
      const _c: never = backend;
      const f = (): string => `closed over: ${_c as string}`;
      return f();
    }
  }
}

// 1. UNREACHABLE - the idiom's normal life. Nothing here may move.
console.log(describe("memory"), describe("sqlite"), describe("postgres"));
console.log(describeNum(1), describeNum(2));
console.log(describeShape({ tag: "a" }), describeShape({ tag: "b" }));
console.log(closureCase("memory"));

// 2. REACHED, through the unsound cast every exhaustiveness switch admits.
console.log(describe("bogus" as Backend));
console.log(describe("" as Backend));
console.log(describeNum(7 as NumKind));
console.log(describeNum(0 as NumKind));
console.log(describeShape({ tag: "zzz" as "a" }));
console.log(closureCase("nope" as Backend));

// 3. The string cases an "almost right" answer hides in: an embedded NUL and
//    a non-ASCII pair, both through JSON.stringify so the escaping shows.
console.log(JSON.stringify(describe("a\u0000b" as Backend)));
console.log(JSON.stringify(describe("éè" as Backend)));
