// A checked cast reads a field an ACCESSOR provides.
//
// `u as R` materializes R's declared members out of the dynamic value, and the
// read it took was JS's [[Get]] MINUS accessors — own data, then the prototype
// chain's data. A field a GETTER provides therefore read as ABSENT, and the two
// halves of that were both wrong and neither was quiet in the same way:
//
//   a REQUIRED field  threw `expected string at $.name, got undefined`
//                     where Node answers the getter's value;
//   an OPTIONAL field built the undefined arm and said NOTHING, which is the
//                     silent-wrong-value half and the worse one.
//
// Node runs the getter on every read of the member; the materializing cast runs
// it ONCE, at the cast, and copies the answer — so this file reads each member
// and never counts getter invocations, which is the one thing the two lanes are
// not obliged to agree on.
//
// Accessors here are declared `enumerable: false`: an enumerable accessor is a
// separate refusal (Object.keys reads the member table and an accessor never
// enters it), and this file is about the READ, not about enumeration.

interface Named {
  name: string;
}
interface MaybeNamed {
  name?: string;
}
interface Outer {
  inner: { name: string };
}

function withGetter(o: unknown, value: string): unknown {
  Object.defineProperty(o as object, "name", {
    get(): string {
      return value;
    },
    enumerable: false,
    configurable: true,
  });
  return o;
}

// A REQUIRED field an own accessor provides.
const own = withGetter(JSON.parse('{"kind":"g"}'), "from-a-getter");
console.log("required own:", (own as Named).name);

// The SAME value through an OPTIONAL declaration — the silent half.
console.log("optional own:", (own as MaybeNamed).name);

// An accessor up the PROTOTYPE chain, which [[Get]] walks too.
const proto = withGetter(JSON.parse("{}"), "from-a-proto-getter");
const child: unknown = Object.create(proto as object);
console.log("required inherited:", (child as Named).name);
console.log("optional inherited:", (child as MaybeNamed).name);

// A DATA member still wins over an accessor further up the chain, and still
// costs no getter call: the data half of the read runs first and answers.
const shadow: unknown = JSON.parse('{"name":"own-data"}');
console.log("data shadows getter:", (shadow as Named).name);

// The same read, one level down: a nested record's field, so the path the old
// failure printed (`$.inner.name`) is the one that now resolves.
const outerSrc: unknown = JSON.parse('{"inner":{}}');
const innerRaw = (outerSrc as { inner: unknown }).inner;
withGetter(innerRaw, "nested-getter");
console.log("nested:", (outerSrc as Outer).inner.name);

// An ARRAY element is a record too.
const arrSrc: unknown = JSON.parse("[{},{}]");
const items = arrSrc as unknown[];
withGetter(items[0], "elem-0");
withGetter(items[1], "elem-1");
const named = arrSrc as Named[];
console.log("array:", named[0]!.name, named[1]!.name);

// (A getter answering the WRONG TYPE still fails the cast, exactly as a data
// member of the wrong type does. Node never checks an `as`, so that case is
// not differential and lives in tests/harness/dyncheck.test.ts instead.)

// And a member that is genuinely absent is still absent: no accessor anywhere
// on the chain means the field reports as missing, unchanged.
const bare: unknown = JSON.parse('{"other":1}');
console.log("still absent:", (bare as MaybeNamed).name);
