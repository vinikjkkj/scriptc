// A store bundle carried into `unknown` and then CALLED through the dyn
// side, where one method takes a FUNCTION parameter whose own return is a
// union with a promise arm — zapo-js's
// `getOrGenPreKeys(count, generator: (keyId) => PreKeyRecord | Promise<PreKeyRecord>)`.
//
// The parameter cannot be ADAPTED out of a dyn value (a promise has no
// out-direction validation), but it can be EXACT-UNWRAPPED: the checked-
// dynamic function box carries the interned signature it was boxed from,
// and an argument boxed from the slot's own type is the very closure.
// canDynCheckTo used to answer canAdaptDynFuncTo here and refuse, so the
// whole method boxed STRANDED — present, `in` answers, calling throws
// SC2009 — while the same func type nested one container down answered
// yes. Node calls it; so does this now.
interface Rec { readonly keyId: number; readonly tag: string }
type Gen = (keyId: number) => Rec | Promise<Rec>;
interface Store {
  getOrGenPreKeys(count: number, gen: Gen): Promise<readonly Rec[]>;
  clear(): Promise<void>;
}

const store: Store = {
  async getOrGenPreKeys(count: number, gen: Gen): Promise<readonly Rec[]> {
    const out: Rec[] = [];
    for (let i = 0; i < count; i++) out.push(await gen(i));
    return out;
  },
  async clear(): Promise<void> { },
};

const gen: Gen = (keyId: number) => ({ keyId: keyId, tag: "t" + keyId });

function carried(v: unknown): string {
  if (typeof v !== "object" || v === null) return "not an object";
  return ("getOrGenPreKeys" in v ? "has getOrGenPreKeys" : "missing") +
    ", " + ("clear" in v ? "has clear" : "missing");
}

async function main(): Promise<void> {
  const u: unknown = store;
  console.log(carried(u));
  // @ts-ignore — a keyed call straight off the dyn value
  const res = await u["getOrGenPreKeys"](3, gen);
  const rs = res as readonly Rec[];
  console.log("n=" + rs.length);
  for (const r of rs) console.log(r.keyId + " " + r.tag);
  // the same method reached back through its own type
  const back = u as Store;
  const again = await back.getOrGenPreKeys(1, gen);
  console.log("again=" + again.length + " " + again[0]!.tag);
}

main();
