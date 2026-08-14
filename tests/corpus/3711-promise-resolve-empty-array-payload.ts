// `Promise.resolve([])` in a slot whose promise payload is an array.
//
// tsc types the call `Promise<never[]>`: the empty literal has no element
// of its own, and `resolve<T>(value: T): Promise<Awaited<T>>` puts a
// conditional type between the slot's contextual type and T, so the
// inference that supplies an element in every ordinary slot never runs.
// `never[]` then maps to the f64 array — the uninhabited's
// representation, not the slot's element — and the return coerced a
// 'Promise<number[]>' the source never wrote:
//
//   error SC1090: 'Promise<number[]>' values where
//   'Promise<{ deviceJids: string[]; jid: string }[]>' is expected
//
// The bare `[]` already takes the slot's element type in an array slot
// and in a return slot; this is the same rule one wrapper out, sound for
// the same reason — the literal is EMPTY, so the element type it is
// BUILT at is unobservable. The lines below pin that the empty payload
// really is empty, that a NON-empty literal still answers the checker's
// element type, and that the promise still settles once with the array
// it was given.

type Row = { readonly jid: string; readonly deviceJids: readonly string[] };

// the zapo spelling: a sync function returning Promise<readonly T[]>
function syncEmpty(n: number): Promise<readonly Row[]> {
  if (n === 0) return Promise.resolve([]);
  return Promise.resolve([{ jid: "a", deviceJids: ["d1", "d2"] }]);
}

// the async twin — a different contextual type (the awaited-or-thenable
// union), so it is a separate question from the sync form
async function asyncEmpty(n: number): Promise<readonly Row[]> {
  if (n === 0) return Promise.resolve([]);
  return Promise.resolve([{ jid: "b", deviceJids: ["e1"] }]);
}

// an ARGUMENT slot rather than a return slot
async function consume(p: Promise<readonly string[]>): Promise<number> {
  return (await p).length;
}

// a plain (non-readonly) array element, and a primitive element
function nums(): Promise<number[]> {
  return Promise.resolve([]);
}
function strs(empty: boolean): Promise<string[]> {
  return empty ? Promise.resolve([]) : Promise.resolve(["x"]);
}

// a nested array element — the element type has to reach two levels down
function rows(): Promise<readonly (readonly string[])[]> {
  return Promise.resolve([]);
}

const a = await syncEmpty(0);
console.log("sync empty:", a.length, Array.isArray(a), JSON.stringify(a));

const b = await syncEmpty(1);
console.log("sync one:", b.length, b[0]!.jid, b[0]!.deviceJids.join("/"));

const c = await asyncEmpty(0);
console.log("async empty:", c.length, JSON.stringify(c));

const d = await asyncEmpty(1);
console.log("async one:", d.length, d[0]!.jid, d[0]!.deviceJids.length);

// What this rule does NOT reach, recorded so the next reader does not
// have to rediscover it: an empty literal NESTED inside a non-empty
// argument (`Promise.resolve([{ deviceJids: [] }])`) still fences. The
// outer literal has an identity a caller can observe, so rebuilding it
// at the contextual width would be a copy — the rule deliberately
// stops at the argument that IS the empty literal.

console.log("argument slot:", await consume(Promise.resolve([])));
console.log("argument slot, filled:", await consume(Promise.resolve(["p", "q"])));

console.log("numbers:", (await nums()).length);
console.log("strings empty:", (await strs(true)).length);
console.log("strings one:", (await strs(false)).join(","));
console.log("nested:", (await rows()).length);

// The promise is a real settled promise, not a value: it awaits once,
// and awaiting the SAME promise twice answers the same array identity.
const p = syncEmpty(0);
const first = await p;
const second = await p;
console.log("same promise, same array:", first === second, first.length);

// push into the awaited empty array — the element type it was built at
// is the slot's, so a Row goes in and reads back as a Row.
const grow: Row[] = [...(await syncEmpty(0))];
grow.push({ jid: "z", deviceJids: ["only"] });
console.log("grown:", grow.length, grow[0]!.jid, grow[0]!.deviceJids[0]);

export {};
