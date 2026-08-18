// A promise crossing the static->dyn boundary. toDynHelper's promise arm
// emits scr_dyn_new_promise_adapting, which lives in scr_async_dyn.c — and
// the link switch for that unit only ever looked at libCalls and dyn-typed
// awaits, so this program emitted a call into a translation unit it never
// asked the linker for and died at LINK time with
//   lld-link: error: undefined symbol: scr_dyn_new_promise_adapting
// (the LLVM lane the same way). Nothing here needs the dynamic engine and
// nothing here calls a dyn-async libCall, which is exactly why the old
// switch stayed silent. It now also fires on a dynFrom/dynCheck whose type
// REACHES a promise through the same recursion the two conversion
// predicates perform: bare, through a record field, and through an array.
async function mk(n: number): Promise<number> { return n * 2; }

function kindOf(v: unknown): string { return typeof v; }

interface Bag { readonly label: string; readonly work: Promise<number> }

async function main(): Promise<void> {
  const p: Promise<number> = mk(21);
  const u: unknown = p;
  console.log(kindOf(u));
  console.log("awaited=" + (await p));

  // one container down: the promise rides a record field into `unknown`
  const bag: Bag = { label: "b", work: mk(4) };
  const ub: unknown = bag;
  console.log(kindOf(ub) + " " + bag.label);
  console.log("bag awaited=" + (await bag.work));

  // and inside an array
  const ps: Promise<number>[] = [mk(1), mk(2)];
  const ua: unknown = ps;
  console.log(kindOf(ua) + " len=" + ps.length);
  console.log("arr awaited=" + (await ps[0]!) + "," + (await ps[1]!));
}

main();
