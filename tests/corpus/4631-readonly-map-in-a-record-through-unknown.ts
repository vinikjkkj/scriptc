// A RECORD CARRYING A ReadonlyMap, widened to `unknown` and narrowed back.
//
// This is rows 5, 6 and 7 of the refusal table — zapo's
// getCollectionState, getCollectionStates and setCollectionStates. Before
// SCR_DYN_MAP the widening was the fence: the store bundle boxed, but its
// methods came back STRANDED, with
//
//   a 'func(string)=>promise<record:rN>' function carried into 'unknown'
//   in field 'getCollectionState' cannot be called through it: its return
//   'promise<record:rN>' has no dynamic conversion            [SC2009]
//
// because canConvertToDyn had no map case at all and fell off the end of
// the function, and canDynCheckTo's nested walker had none either.
//
// THE MAP IS THE WHOLE PROBE, AND THIS IS THE TRAP THE MESSAGE SETS. The
// refusal names `promise`, so the obvious reduction — the same methods
// with the Map field deleted — is a promise-returning method carried into
// `unknown`, and THAT BOXES on base, in both directions. A promise-only
// probe passes while zapo fails. Every `ids` field below is load-bearing:
// delete them and this program compiles on base with no fence at all.
//
// The half that makes the crossing worth having is the RETURN. A map that
// came back as a copy would be a different object, and the assertions at
// the bottom are what says it does not.

interface CollState {
  readonly ids: ReadonlyMap<string, string>;
  readonly n: number;
}

interface Store {
  getCollectionState(c: string): Promise<CollState>;
  getCollectionStates(cs: string[]): Promise<CollState[]>;
  setCollectionStates(s: CollState[]): Promise<void>;
}

const backing = new Map<string, string>();
backing.set("alpha", "one");
backing.set("beta", "two");

const store: Store = {
  getCollectionState(c: string): Promise<CollState> {
    return Promise.resolve({ ids: backing, n: backing.size + c.length });
  },
  getCollectionStates(cs: string[]): Promise<CollState[]> {
    const out: CollState[] = [];
    for (const c of cs) out.push({ ids: backing, n: c.length });
    return Promise.resolve(out);
  },
  setCollectionStates(s: CollState[]): Promise<void> {
    let total = 0;
    for (const st of s) total += st.ids.size + st.n;
    console.log("set", s.length, total);
    return Promise.resolve();
  },
};

// The crossing: the bundle goes into `unknown`, and the methods are
// CALLED THROUGH THE DYN SIDE. That last part is the whole test. Reaching
// them back through `carried as Store` unwraps the record and calls the
// ORIGINAL closures statically, which never touches the boxed thunk and
// so passes on base with no fence at all — measured, not assumed. The
// keyed calls below are the ones that go through the box.
const carried: unknown = store;

async function main(): Promise<void> {
  // Row 5 — a single state, the map read on the far side of the round trip.
  // @ts-ignore — a keyed call straight off the dyn value
  const one = (await carried["getCollectionState"]("k")) as CollState;
  console.log("row5", one.n, one.ids.size, one.ids.get("alpha"));

  // Row 6 — an array of them.
  // @ts-ignore
  const many = (await carried["getCollectionStates"](["aa", "bbb"])) as CollState[];
  console.log("row6", many.length, many[0]!.n, many[1]!.n, many[0]!.ids.get("beta"));

  // Row 7 — the map going the OTHER way, as a parameter validated OUT of
  // a dyn value rather than converted into one.
  // @ts-ignore
  await carried["setCollectionStates"](many);

  // And the same methods reached back through their own type, which is
  // the static path and must keep answering identically.
  const back = carried as Store;
  const again = await back.getCollectionState("zz");
  console.log("static", again.n, again.ids.size);

  // Identity: the map that comes back is the map that went in, not a copy.
  // This is the assertion the reference box exists for — a copy would
  // answer true for `size` and false here.
  console.log("identity", one.ids === backing, many[0]!.ids === one.ids);

  // A write through the original is seen through the round-tripped
  // reference, which is the same statement one level down.
  backing.set("gamma", "three");
  console.log("shared", one.ids.size, one.ids.get("gamma"));
}

void main();
