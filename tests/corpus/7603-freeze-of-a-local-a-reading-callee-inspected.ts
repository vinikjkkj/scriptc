// Object.freeze over a FRESH LOCAL that was handed to a validator first —
// the accumulate, CHECK, then publish idiom. store-sqlite's table-name
// resolver is the program that made it matter:
//
//   const resolved = { ...DEFAULTS }
//   for (...) resolved[k] = normalize(v)
//   assertNoDuplicates(resolved)      // <- reads it, keeps nothing
//   return Object.freeze(resolved)
//
// The freeze fence's question is never "who can SEE this value" but "who can
// WRITE through it after the freeze". A callee whose parameter is only ever
// the object of a property or element READ cannot: reads do not observe the
// frozen bit, whenever they happen, and a parameter that never appears as a
// whole value cannot have been retained. So the call is as harmless to the
// frozen bit as no call at all, and the freeze stays the identity it already
// is over a literal.
//
// Everything here is what the program VALUE is; frozen-ness itself is
// unobservable by construction, which is the argument.

type Table = Record<string, string>;

const DEFAULTS: Table = { a: "a", b: "b", c: "c" };

// A callee that only reads through its parameter: element access in a loop,
// property access, and a comparison. Nothing keeps the value.
function assertNoDuplicates(t: Table, order: string[]): void {
  const seen: string[] = [];
  for (const k of order) {
    const v = t[k];
    if (v === undefined) throw new Error(`missing ${k}`);
    if (seen.indexOf(v) !== -1) throw new Error(`duplicate ${v}`);
    seen.push(v);
  }
}

// A second reader, this one answering a value derived from reads only.
function serialize(t: Table, order: string[]): string {
  let out = "";
  for (const k of order) out += `${k}=${t[k]};`;
  return out;
}

function resolve(overrides: Table): Readonly<Table> {
  const order = ["a", "b", "c"];
  const resolved: Table = { a: DEFAULTS["a"]!, b: DEFAULTS["b"]!, c: DEFAULTS["c"]! };
  for (const k of order) {
    const v = overrides[k];
    if (v !== undefined) resolved[k] = v.trim();
  }
  assertNoDuplicates(resolved, order);
  const line = serialize(resolved, order);
  if (line.length === 0) throw new Error("empty");
  return Object.freeze(resolved);
}

const plain = resolve({});
console.log(plain["a"], plain["b"], plain["c"]);
console.log(serialize(plain, ["a", "b", "c"]));

const renamed = resolve({ b: "  bee  ", c: "sea" });
console.log(renamed["a"], renamed["b"], renamed["c"]);
console.log(serialize(renamed, ["a", "b", "c"]));

// Two resolutions are independent objects.
console.log(plain["b"], renamed["b"]);

// The duplicate check still fires — the callee is a real validator, not a
// decoration the fence talked its way past.
try {
  resolve({ b: "a" });
  console.log("no throw");
} catch (e) {
  console.log(`threw: ${e instanceof Error ? e.message : String(e)}`);
}

// The same shape over an ARRAY local: filled by a loop, read by a callee,
// then published frozen.
function sum(ns: number[]): number {
  let t = 0;
  for (let i = 0; i < ns.length; i++) t += ns[i]!;
  return t;
}
function evensUpTo(n: number): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) if (i % 2 === 0) out.push(i);
  if (sum(out) < 0) throw new Error("impossible");
  return Object.freeze(out);
}
const evens = evensUpTo(8);
console.log(evens.join(","), evens.length, sum([...evens]));

// A callee that reads through a NESTED closure still only reads, and a read
// can never observe the frozen bit however late it happens.
function laterReader(t: Table): () => string {
  return () => `${t["a"]}/${t["b"]}`;
}
function publish(): Readonly<Table> {
  const t: Table = { a: "x", b: "y", c: "z" };
  t["a"] = "X";
  const peek = laterReader(t);
  if (peek().length === 0) throw new Error("empty");
  return Object.freeze(t);
}
const pub = publish();
console.log(pub["a"], pub["b"], pub["c"]);
