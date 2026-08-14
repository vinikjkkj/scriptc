// A const whose INITIALIZER lowered to a class instance keeps the INSTANCE,
// and its DATA FIELDS read off that instance.
//
// lowerVarDecl already adopts the initializer's type for a const whose
// declared type maps to a record -- "the interface is erasure over a nominal
// value: keeping the instance type reads members as the class's own methods
// instead of demanding a record shape the value never had". The METHOD side
// kept that promise (lowerObjectMethodCall's exactInstanceClassOf rescue).
// The DATA side never did: `const x: Iface = new Impl(); x.v` fenced with
// SC1090 "reading 'v' from a value of type 'Iface'" -- on the very shape the
// adoption rule was written for, at file scope and at block scope alike.
//
// The read is the same fieldGet a method body's own `this.v` emits, over the
// flattened instance-field map, so the binding stays the ONE object: r05
// observes a mutation made through the class after the view binding exists.
//
// SCOPE MATTERS and this file is careful about it. A FILE-scope const is a
// pre-registered module global, and its type is decided by collectGlobals,
// which adopts only for a DIRECT `new`. `const seen: Iface = live` at file
// scope therefore still takes the width-copy route (the documented copy
// stance) and is deliberately not exercised here -- every alias-observing row
// below sits in a BLOCK, where lowerVarDecl's adoption chain runs.
//
// What deliberately still fences, and so cannot appear here (a fence aborts
// the build, it cannot be a differential row):
//   - an ACCESSOR-satisfied name (`get v()`): a getter has no data slot, and
//     a raw fieldGet would read past the dispatch. ctorWitnessProjection
//     draws the same line for the same pair.
//   - a bare METHOD reference (`const f = x.m`): bound method references have
//     no value form, and that fence is older and unchanged.

interface Counter {
  readonly label: string;
  readonly limit: number;
  readonly tags: readonly string[];
  bump(): number;
}

class CounterImpl implements Counter {
  public readonly label = "c1";
  public readonly limit = 3;
  public readonly tags: readonly string[] = ["a", "b"];
  public n = 0;
  public bump(): number {
    this.n += 1;
    return this.n;
  }
}

// ------------------------------------------------ 1. the canonical spelling
// `const x: Iface = new Impl()` at FILE scope. The method call already
// worked; the field reads are what this pins.
const fileScoped: Counter = new CounterImpl();
console.log("r01", fileScoped.label, fileScoped.limit);
console.log("r02", fileScoped.tags.length, fileScoped.tags[0], fileScoped.tags[1]);
console.log("r03", fileScoped.bump(), fileScoped.bump());

// ...and at BLOCK scope, which is a different code path in lowerVarDecl (a
// file-scope const is a pre-registered module global; a block-scoped one runs
// the adoption chain) and answered the same fence.
{
  const blockScoped: Counter = new CounterImpl();
  console.log("r04", blockScoped.label, blockScoped.limit, blockScoped.bump());
}

// ---------------------------------------------- 2. the binding IS the object
// No copy stands between the annotation and the instance: a mutation made
// through the class is visible through the adopted binding.
{
  const live = new CounterImpl();
  const view = live as unknown as { n: number };
  console.log("r05a", live.bump(), live.bump());
  console.log("r05b", view.n);
  live.bump();
  console.log("r05c", view.n);
}

// ------------------------------------------------------- 3. the CAST spelling
// `client as unknown as { field: ... }` erases to the same instance, so the
// const adopts it exactly as the annotation does -- but exactInstanceClassOf
// reads the SYNTAX (const + a direct `new`) and cannot see a cast, so both
// the read and the call fenced here. This is zapo's spelling: a PRIVATE field
// reached through a structural cast.
class Holder {
  private readonly inner: CounterImpl = new CounterImpl();
  public readonly name = "holder";
  public peek(): number {
    return this.inner.limit;
  }
}
const holder = new Holder();
console.log("r06", holder.name, holder.peek());
{
  const asRecord = holder as unknown as { name: string };
  console.log("r07", asRecord.name);
}

// A field read off the cast, then a METHOD CALL on what it answered -- the
// two-step chain zapo's `wb.writeBehind.flush(2000)` is.
{
  const reach = holder as unknown as { inner: { bump(): number; label: string } };
  console.log("r08", reach.inner.label);
  console.log("r09", reach.inner.bump(), reach.inner.bump());
}

// ------------------------------------------------ 4. nested and inherited
class Base {
  public readonly baseField = "B";
  public readonly shared = 1;
}
class Derived extends Base {
  public readonly ownField = "D";
}
{
  const d = new Derived() as unknown as { baseField: string; ownField: string; shared: number };
  console.log("r10", d.baseField, d.ownField, d.shared);
}

// The field's own type is whatever the class declares -- a composite reads as
// itself, and the read is not a copy either.
class Bag {
  public readonly items: string[] = ["x"];
}
{
  const bag = new Bag();
  const view = bag as unknown as { items: string[] };
  view.items.push("y");
  console.log("r11", bag.items.length, bag.items.join(","), view.items.join(","));
}
