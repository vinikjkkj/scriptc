// A `Promise<unknown>` flowing into a `Promise<T>` slot -- the dedup-map
// idiom zapo's `PromiseDedup.run<T>` writes:
//
//   private readonly inFlight = new Map<string, Promise<unknown>>()
//   const existing = this.inFlight.get(key)
//   if (existing) return existing as Promise<T>
//
// The payload conversion is `dynCheck`: the adapted promise awaits the
// source and VALIDATES what comes out against T, so a payload that does not
// match throws a catchable TypeError instead of being misread. That is the
// same stance a bare `unknown` value takes flowing into a typed slot; the
// promise only puts it one container out.
//
// The T's here are the shapes zapo instantiates `run` with, and the point of
// the file is the ones JSON-safety refuses: a record carrying a Uint8Array
// field, an array of such records, and a nullable record. The bytes leaf has
// no JSON round trip, but the dynCheck walker validates it field by field --
// which is why the conversion's domain is dynCheck's, not JSON's.

class PromiseDedup {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  public run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const created = Promise.resolve()
      .then(() => task())
      .finally(() => {
        // zapo guards this with `if (this.inFlight.get(key) === created)`.
        // That comparison cannot be written here: the map slot holds the
        // promise through a PAYLOAD conversion, so the two sides are
        // different objects and scriptc fences the comparison rather than
        // answering false. The unguarded delete is the same eviction for a
        // single writer per key, which is what this file exercises.
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, created);
    return created;
  }
}

type KeyRec = { readonly keyHash: Uint8Array; readonly timestamp: number | undefined };
type Device = { readonly jid: string; readonly deviceJids: readonly string[] };
type Sender = { readonly identity: Uint8Array; readonly jid: string; readonly type: number | undefined };

function nap(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

let calls = 0;

async function loadKey(n: number): Promise<KeyRec> {
  calls = calls + 1;
  await nap(4);
  return { keyHash: new Uint8Array([1, 2, n]), timestamp: n === 0 ? undefined : n };
}
async function loadDevices(user: string): Promise<readonly Device[]> {
  calls = calls + 1;
  await nap(4);
  return [{ jid: user, deviceJids: [user + ":0", user + ":1"] }];
}
async function loadSenders(): Promise<readonly Sender[]> {
  calls = calls + 1;
  await nap(4);
  const one: Sender = { identity: new Uint8Array([7]), jid: "a@s", type: 1 };
  const two: Sender = { identity: new Uint8Array([8, 9]), jid: "b@s", type: undefined };
  return [one, two];
}
async function loadMaybe(hit: boolean): Promise<KeyRec | null> {
  calls = calls + 1;
  await nap(4);
  return hit ? { keyHash: new Uint8Array([4, 5]), timestamp: 99 } : null;
}

const dedup = new PromiseDedup();

async function main(): Promise<void> {
  // (1) Two callers race the SAME key: the second takes the stored promise
  // through the downcast, and both see the one task's value.
  const a = dedup.run("key:5", () => loadKey(5));
  const b = dedup.run("key:5", () => loadKey(5));
  const ra = await a;
  const rb = await b;
  console.log("1:", calls, ra.keyHash.length, ra.keyHash[2], ra.timestamp);
  console.log("  dup:", rb.keyHash.length, rb.keyHash[2], rb.timestamp);

  // (2) The undefined arm of an optional field survives the round trip.
  const zero = await dedup.run("key:0", () => loadKey(0));
  console.log("2:", zero.timestamp === undefined ? "undefined" : String(zero.timestamp), zero.keyHash[2]);

  // (3) An ARRAY of records, deduped -- the array is rebuilt by the check
  // and reads back element by element.
  const d1 = dedup.run("dev:u@s", () => loadDevices("u@s"));
  const d2 = dedup.run("dev:u@s", () => loadDevices("u@s"));
  const rd1 = await d1;
  const rd2 = await d2;
  console.log("3:", rd1.length, rd1[0].jid, rd1[0].deviceJids.join("|"));
  console.log("  dup:", rd2.length, rd2[0].deviceJids.length);

  // (4) An array of BYTES-bearing records: the leaf JSON cannot carry.
  const s1 = dedup.run("send", () => loadSenders());
  const s2 = dedup.run("send", () => loadSenders());
  const rs1 = await s1;
  const rs2 = await s2;
  console.log("4:", rs1.length, rs1[0].identity[0], rs1[1].identity.length, rs1[1].type === undefined ? "undefined" : "set");
  console.log("  dup:", rs2[0].jid, rs2[1].jid);

  // (5) A NULLABLE payload, both arms.
  const m1 = await dedup.run("maybe:hit", () => loadMaybe(true));
  const m2 = await dedup.run("maybe:miss", () => loadMaybe(false));
  console.log("5:", m1 === null ? "null" : String(m1.timestamp), m2 === null ? "null" : "set");

  // (6) The entry is REMOVED once it settles, so a later call runs the task
  // again rather than taking the downcast.
  const before = calls;
  const again = await dedup.run("key:5", () => loadKey(5));
  console.log("6:", calls - before, again.keyHash[2]);

  // (7) The rejection travels through the downcast untouched: both waiters
  // see the same error, and the key is released.
  let n = 0;
  const boom = async (): Promise<KeyRec> => {
    n = n + 1;
    await nap(3);
    throw new Error("load-failed");
  };
  const f1 = dedup.run("boom", boom);
  const f2 = dedup.run("boom", boom);
  const msgs: string[] = [];
  try {
    await f1;
  } catch (e) {
    msgs.push(e instanceof Error ? e.message : "non-error");
  }
  try {
    await f2;
  } catch (e) {
    msgs.push(e instanceof Error ? e.message : "non-error");
  }
  console.log("7:", n, msgs.join(","));

  console.log("total calls:", calls);
}

void main();
