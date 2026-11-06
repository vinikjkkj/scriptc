// A Promise<Wide> flowing into a Promise<Narrow> slot, where every Narrow field exists in Wide at the same type: the awaited
// value is the SAME object seen through the narrow shape, so writes show through both ways and the view is one per object.
type Wide = { a: number; b: string; extra: number; note?: string };
type Narrow = { a: number; b: string };

const named: Wide = { a: 1, b: "x", extra: 9 };

function narrowSlot(p: Promise<Narrow>): Promise<Narrow> {
  return p;
}

async function prepare(): Promise<{ readonly body: string; readonly meta: Promise<Narrow> }> {
  const source: { readonly body: string; readonly meta: Promise<Wide> } = { body: "ok", meta: Promise.resolve(named) };
  return { body: source.body, meta: source.meta };
}

async function main(): Promise<void> {
  const viaParam = await narrowSlot(Promise.resolve(named));
  const viaParamAgain = await narrowSlot(Promise.resolve(named));
  console.log("same object through two adoptions", viaParam === viaParamAgain);
  named.a = 5;
  console.log("wide write seen through narrow", viaParam.a);
  viaParam.b = "changed";
  console.log("narrow write seen through wide", named.b);

  const prepared = await prepare();
  const meta = await prepared.meta;
  console.log("field view reads the object", meta.a, meta.b);
  const again = await prepared.meta;
  console.log("same view twice", again === meta);
  named.a = 11;
  console.log("after another write", meta.a, again.a);
}
main();
