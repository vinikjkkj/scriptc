// A heterogeneous `Promise.all` whose entry is ALREADY RESOLVED on one arm
// and pending on the other -- `Promise.all([options.localIdentity ??
// requireLocalIdentity(store), generateSerializedKeyPair()])`, the shape
// both session openers in zapo-js 1.8.2's `signal/session/SignalProtocol.ts`
// write (:111 and :153).
//
// Corpus 3203 already pins the `Promise<T> | null` spelling of this. The
// only thing new here is that the non-promise arm carries a VALUE: the
// caller may hand in the identity it already has, and the callee fetches it
// otherwise. The adapter's branch is the same one either way -- the arm
// that is not a promise is RETURNED, never awaited -- so the rule that
// matters is "exactly one promise arm", not "the other arm is a unit".
//
// What this pins against Node:
//
//   * both arms of the maybe-entry, at a position whose payload TYPE is the
//     same on both (the merge collapses to one type, so the result tuple's
//     position is not a union at all);
//   * the same entry where the arms DIFFER, so the position IS a union and
//     each side has to narrow back out of the combinator's shared one;
//   * a void entry beside a maybe-entry (the two adapters in one call);
//   * the rejection order: `Promise.all` rejects with whichever entry
//     rejected first in TIME, and an already-resolved arm beside a slow
//     rejecting one must not turn that into first-in-POSITION;
//   * the microtask accounting -- the resolved arm fulfills IMMEDIATELY, so
//     the ticks queued after the call still run before the combined result.

type Ident = { readonly regId: number; readonly key: string };
type KeyPair = { readonly pub: string; readonly priv: string };
type Session = { readonly id: string };

async function loadIdent(regId: number): Promise<Ident> {
  await new Promise<void>((r) => setTimeout(r, 5));
  return { regId, key: "k" + regId };
}
async function genKeyPair(): Promise<KeyPair> {
  await new Promise<void>((r) => setTimeout(r, 3));
  return { pub: "pub", priv: "priv" };
}
async function markStale(id: string): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 2));
  stale.push(id);
}
async function getSession(id: string): Promise<Session> {
  await new Promise<void>((r) => setTimeout(r, 4));
  return { id };
}
async function slowBoom(ms: number): Promise<KeyPair> {
  await new Promise<void>((r) => setTimeout(r, ms));
  throw new Error("keypair-failed");
}

const stale: string[] = [];

// The identity the caller MAY already hold: present, it settles the
// position as itself; absent, the loader's promise does.
async function openSession(preset: Ident | undefined): Promise<void> {
  const [local, base] = await Promise.all([preset ?? loadIdent(7), genKeyPair()]);
  console.log("open", local.regId, local.key, base.pub);
}

// The arms DISAGREE: the caller's value is a plain id, the loader answers a
// whole identity. `Awaited<Promise<Ident> | string>` is `Ident | string`, so
// the position is a union and both sides re-tag out of the shared one.
async function openEither(preset: string | undefined): Promise<void> {
  const [local, base] = await Promise.all([preset ?? loadIdent(9), genKeyPair()]);
  console.log("either", typeof local === "string" ? local : local.regId, base.priv);
}

// A void entry beside the maybe-entry: two different adapters feeding one
// combinator, and the void one's WORK still has to happen.
async function refreshSession(preset: Ident | undefined): Promise<void> {
  const [ident, , session] = await Promise.all([
    preset ?? loadIdent(3),
    markStale("s1"),
    getSession("s1"),
  ]);
  console.log("refresh", ident.regId, session.id, stale.join(","));
}

async function main(): Promise<void> {
  await openSession(undefined);
  await openSession({ regId: 42, key: "given" });
  await openEither(undefined);
  await openEither("just-an-id");
  await refreshSession({ regId: 1, key: "k1" });

  await ticksBeforeTheResult({ regId: 99, key: "k99" });
  await rejectionWins({ regId: 99, key: "k99" }, 6);
  await rejectionWins(undefined, 1);
}

// The resolved arm fulfills IMMEDIATELY, so the ticks queued right after
// the call still run before the combined result arrives.
async function ticksBeforeTheResult(present: Ident | undefined): Promise<void> {
  const seq: string[] = [];
  const pending = Promise.all([present ?? loadIdent(0), genKeyPair()]);
  void Promise.resolve().then(() => {
    seq.push("tick1");
  });
  void Promise.resolve().then(() => {
    seq.push("tick2");
  });
  const [a, b] = await pending;
  seq.push("all " + a.regId + " " + b.pub);
  console.log(seq.join("|"));
}

// The rejection that wins is the first in TIME. With `present` supplied,
// position 0 is already settled and position 1 rejects later -- a sequence
// of awaits would have answered position 0 first and never seen it. With
// `present` absent, position 0 is the SLOW promise and the rejection is
// still the one that arrives first.
async function rejectionWins(present: Ident | undefined, ms: number): Promise<void> {
  try {
    const [x, y] = await Promise.all([present ?? loadIdent(11), slowBoom(ms)]);
    console.log("unreachable", x.regId, y.pub);
  } catch (e) {
    console.log("rejected with:", e instanceof Error ? e.message : "?");
  }
}

void main();
