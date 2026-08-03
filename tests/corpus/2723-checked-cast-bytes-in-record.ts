// A checked cast whose target holds a Uint8Array inside a composite.
//
// The dynCheck walker builds one check per type and calls the per-field
// check for each field, and it has known how to validate a bytes leaf
// standing alone for as long as bytes targets have been castable. Nested
// was refused anyway: the admission asked whether the WHOLE target was
// JSON-safe, and a byte field is not JSON, so one such field made the
// entire composite unspellable even though every part of it was
// checkable.
//
// Only the POSITIVE and EMPTY directions are exercised here. A cast of a
// value that does not match throws a catchable TypeError, where Node --
// which erases casts entirely -- accepts it silently; that divergence is
// the documented dynCheck stance, so a corpus program (diffed against
// Node) cannot carry it.
type Stored = { id: string; bytes: Uint8Array | undefined; count: number };

// The empty case: a frozen empty list handed out as a typed one, which is
// what a no-op store returns.
const EMPTY = Object.freeze([]) as readonly unknown[];
console.log((EMPTY as readonly Stored[]).length);

const raw: unknown = [
  { id: "a", bytes: new Uint8Array([1, 2, 3]), count: 1 },
  { id: "b", bytes: undefined, count: 2 },
];
const rows = raw as Stored[];
console.log(rows.length, rows[0].id, rows[1].id);
console.log(rows[0].bytes?.length, rows[1].bytes === undefined);
console.log(rows[0].bytes?.[0], rows[0].bytes?.[2]);

let total = 0;
for (const r of rows) total += r.count + (r.bytes === undefined ? 0 : r.bytes.length);
console.log(total);

// One level deeper: bytes inside a record inside a record.
type Wrap = { name: string; inner: { blob: Uint8Array } };
const nested: unknown = { name: "w", inner: { blob: new Uint8Array([9, 8]) } };
const w = nested as Wrap;
console.log(w.name, w.inner.blob.length, w.inner.blob[1]);
