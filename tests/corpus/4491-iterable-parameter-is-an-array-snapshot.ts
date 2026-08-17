// `function pickActiveSyncKey(keys: Iterable<WaAppStateSyncKey>)` — a parameter
// whose declared type is the structural iterable interface, and the producers
// that reach one.
//
// This is zapo `appstate/utils.ts:35`, and on a live paired run against the
// fake server it is the LARGEST live refusal row (x9) AND the one that decides
// what the program does: it is the error that aborts six of the driver's
// twenty-eight steps (`chat.sync`, `chat.setChatArchive`, `chat.setChatMute`,
// `chat.setChatPin`, `chat.setChatRead`, `chat.flushMutations`), and with it
// fenced the server receives 0 of Node's 7 app-state mutations and 0 of Node's
// 9 `w:sync:app:state` iq stanzas — which is the whole 41 -> 32 iq gap.
//
// `Iterable<T>` publishes exactly one member, `[Symbol.iterator]()`. A value of
// that type can be iterated and nothing else — no length, no index, no method a
// consumer could call — so the representation is the ARRAY SNAPSHOT that
// `[...it]` already builds.
//
// ARRAY, not the `generator` kind, and `countTwice` is why: an Iterable may be
// iterated more than once, and JS answers 202 here. A one-shot pull handle
// answers 2 the second time round and never says so.
//
// The producer side is the other half. `m.values()` had exactly three admitted
// contexts, all immediate drains (`[...m.values()]`, `m.values().next().value`,
// `Array.from(m.values())`); the sole argument of a call whose slot is
// `Iterable<T>` is a fourth, because nothing evaluates between the iterator's
// creation and its drain and the consumer cannot do anything but iterate. That
// is what makes `pickActiveSyncKey(this.keys.values())` — zapo
// `store/memory/appstate.store.ts:135`, the one production caller — compile;
// the parameter type alone does not, and this fixture pins both halves.
//
// The producer boundary this change does NOT cross, stated because the first
// draft of this fixture DID cross it and that is how the hole was found: a
// `Set<T>` argument in an `Iterable<T>` slot still refuses, LOUDLY, at the call
// site (`SC1090: 'Set<number>' values where 'number[]' is expected` — see
// tests/diagnostics/iterable-set-producer.ts). Every producer here is one whose
// drain is already a lowering: an array is the identity, and the map iterator
// methods drain in place. Nothing became a silent answer.
//
// `firstId` is here because early exit is the one thing the snapshot pays for:
// the drain is complete before the callee sees the first element, so the answer
// is identical and only the work differs. `pickHighest([])` and `firstId([])`
// pin the empty case, where "no elements" must not become "undefined element".

interface Key {
  readonly id: number;
  readonly epoch: number;
}

function pickHighest(keys: Iterable<Key>): Key | null {
  let best: Key | null = null;
  for (const k of keys) {
    if (best === null || k.epoch > best.epoch) {
      best = k;
    }
  }
  return best;
}

function countTwice(keys: Iterable<Key>): number {
  let n = 0;
  for (const _a of keys) {
    n += 1;
  }
  for (const _b of keys) {
    n += 100;
  }
  return n;
}

function joinIds(keys: Iterable<Key>): string {
  const out: string[] = [];
  for (const k of keys) {
    out.push(String(k.id));
  }
  return out.join(",");
}

function joinStrings(it: Iterable<string>): string {
  const out: string[] = [];
  for (const v of it) {
    out.push(v);
  }
  return out.join("|");
}

function firstId(keys: Iterable<Key>): number {
  for (const k of keys) {
    return k.id;
  }
  return -1;
}

function sumNumbers(it: Iterable<number>): number {
  let total = 0;
  for (const v of it) {
    total += v;
  }
  return total;
}

const a: Key = { id: 1, epoch: 5 };
const b: Key = { id: 2, epoch: 9 };
const c: Key = { id: 3, epoch: 7 };

// PRODUCER 1 — an array literal.
console.log(pickHighest([a, b, c])?.id ?? -1);
console.log(countTwice([a, b, c]));
console.log(joinIds([a, b, c]));
console.log(firstId([a, b, c]));

// The empty case, both ways.
console.log(pickHighest([])?.id ?? -1);
console.log(firstId([]));
console.log(countTwice([]));

// PRODUCER 2 — a readonly array binding.
const ro: readonly Key[] = [b, a];
console.log(pickHighest(ro)?.id ?? -1);
console.log(joinIds(ro));

// PRODUCER 3 — the map iterator methods as the sole argument.
const m = new Map<string, Key>([
  ["ka", a],
  ["kb", b],
  ["kc", c],
]);
console.log(pickHighest(m.values())?.id ?? -1);
console.log(joinIds(m.values()));
console.log(firstId(m.values()));
console.log(joinStrings(m.keys()));

const ms = new Map<string, string>([
  ["x", "1"],
  ["y", "2"],
]);
console.log(joinStrings(ms.keys()));
console.log(joinStrings(ms.values()));

// A scalar element type, so the snapshot is exercised over a non-record too.
console.log(sumNumbers([10, 20]));
console.log(sumNumbers([]));

// A map that shrinks between two calls: each call snapshots afresh.
m.delete("kb");
console.log(pickHighest(m.values())?.id ?? -1);
console.log(joinIds(m.values()));
