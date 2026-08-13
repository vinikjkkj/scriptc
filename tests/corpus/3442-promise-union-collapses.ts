// A ternary over two promises types as `Promise<A> | Promise<B>` — the
// shape `cond ? Promise.resolve(null) : requirePreKey(id)` takes, and
// zapo's SignalProtocol.decryptPkMsg spelling. It is the SAME type as
// `Promise<A | B>`: same inhabitants, and a promise is read-only through
// await/then, so no operation can observe which arm a value came from.

interface PreKeyRecord {
  readonly id: number;
  readonly label: string;
}

async function requirePreKey(id: number): Promise<PreKeyRecord> {
  return { id, label: "k" + String(id) };
}

// Two arms, one of them the unit `null`.
async function optional(id: number | null): Promise<string> {
  const p = id === null ? Promise.resolve(null) : requirePreKey(id);
  const v = await p;
  return v === null ? "none" : v.label + ":" + String(v.id);
}

// Three arms, mixing a record payload with a scalar one — the payload
// union earns its home under the ordinary union rules.
async function three(k: number): Promise<string> {
  const p =
    k === 0 ? Promise.resolve(null) : k === 1 ? requirePreKey(1) : Promise.resolve("plain");
  const v = await p;
  if (v === null) return "null";
  if (typeof v === "string") return "s:" + v;
  return "r:" + v.label;
}

// Both arms over the SAME payload: one promise, no union needed.
async function samePayload(k: boolean): Promise<string> {
  const p = k ? requirePreKey(1) : requirePreKey(2);
  return (await p).label;
}

// The collapsed promise is a value: it can be stored, passed, and awaited
// somewhere else entirely.
async function passed(p: Promise<null> | Promise<PreKeyRecord>): Promise<string> {
  const v = await p;
  return v === null ? "passed-none" : "passed-" + v.label;
}

// Each arm evaluates exactly once, and only the arm the condition picks.
let calls = 0;
async function counted(id: number | null): Promise<string> {
  const p = id === null ? Promise.resolve(null) : requirePreKey(((calls += 1), id));
  const v = await p;
  return (v === null ? "n" : v.label) + " calls=" + String(calls);
}

console.log(await optional(null), await optional(3));
console.log(await three(0), await three(1), await three(2));
console.log(await samePayload(true), await samePayload(false));
console.log(await passed(Promise.resolve(null)));
console.log(await passed(requirePreKey(8)));
console.log(await counted(null));
console.log(await counted(9));

// Awaiting the same collapsed promise twice yields the same settled value.
const pick = Number(process.argv.length) > 1000;
const shared = pick ? Promise.resolve(null) : requirePreKey(42);
const first = await shared;
const second = await shared;
console.log("stable:", first === second, first === null ? "null" : first.label);

export {};
