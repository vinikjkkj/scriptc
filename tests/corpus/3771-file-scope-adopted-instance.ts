// One const holding a class instance means ONE thing at BOTH scopes.
//
// lowerVarDecl's adoption arm reads the LOWERED initializer -- `!isLet &&
// init.type.kind === "object"` over a declared type that maps to a record --
// so a BLOCK-scoped `const v: Iface = live` and `const v = live as unknown as
// { ... }` both keep the instance. collectGlobals owns the FILE-scope twin of
// that arm, and it only recognised a syntactic `new`, so the same declaration
// one scope up took the record slot instead. A record slot COPIES at the
// assignment.
//
// The copy is a silent wrong answer, not a fence, which is why no census ever
// saw it. `const v: Iface = live; live.bump(); v.n` read the value the field
// had BEFORE the mutation, and `v.n = 1` never reached the object. Node has
// one object and answers both. 3731's header recorded the divergence as the
// documented copy stance and deliberately put every alias-observing row in a
// BLOCK; this file is that restriction lifted, and every row below is at FILE
// scope on purpose.
//
// collectGlobals runs before any body lowers, so it cannot ask the lowering
// what an initializer produced. adoptedInstanceClassOf mirrors it for the two
// spellings whose value provably IS an identifier's own instance, and REFUSES
// rather than predicts the casts that do not erase: a target that maps to an
// object builds lowerAsExpression's checked-downcast or upcast bridge (so the
// value's class is the target's, not the identifier's -- r08), and `as any`
// under --dynamic is the island entrance. Anything past an identifier -- a
// call, an element read, a property read -- is out.
//
// What deliberately still fences, and so cannot appear here (a fence aborts
// the build, it cannot be a differential row):
//   - an ACCESSOR-satisfied name through an adopted binding: a getter has no
//     data slot. ctorWitnessProjection declines the same pair, so the base
//     compiler fenced this shape at the DECLARATION instead -- the fence
//     moved, it did not appear.
//   - a name the class does not carry, smuggled in by a cast: the flattened
//     instance-field map is the authority, which is what makes it loud.
//   - a member whose CHECKER type is wider than the class's own slot
//     (`n: number | string` over `n: number`): reads are fine, a write of the
//     wider value has no slot and fences at the value.

interface Meter {
  readonly label: string;
  count: number;
  bump(): number;
}

class MeterImpl implements Meter {
  public readonly label = "m1";
  public count = 0;
  public bump(): number {
    this.count += 1;
    return this.count;
  }
}

// ------------------------------------------- 1. the ANNOTATION spelling
// `const v: Iface = live` at FILE scope, over an EXISTING instance. The
// binding is the object: a mutation made through the class after the binding
// exists is visible through it.
const live = new MeterImpl();
const view: Meter = live;
console.log("r01", view.label, view.count);
live.bump();
live.bump();
console.log("r02", view.count);
console.log("r03", view.bump(), live.count);

// ------------------------------------------------ 2. the CAST spelling
// `live as unknown as { ... }` erases to the same instance. This is zapo's
// spelling, and at file scope it took the projection route while the same
// text inside a `try` block took the nominal one.
class Client {
  private readonly inner: MeterImpl = new MeterImpl();
  public readonly name = "client";
  public peek(): number {
    return this.inner.count;
  }
}
const client = new Client();
const asRecord = client as unknown as {
  name: string;
  inner: { count: number; bump(): number };
};
console.log("r04", asRecord.name, client.peek());
console.log("r05", asRecord.inner.bump(), asRecord.inner.bump(), client.peek());

// ---------------------------------- 3. the peel: parens and `satisfies`
const viaSatisfies: Meter = ((live satisfies Meter));
live.bump();
console.log("r06", viaSatisfies.count, live.count);

// ------------------------------------------------- 4. `let` does NOT adopt
// The adoption arm is `!isLet` at both scopes: a reassignable binding could
// hold another class later, and here it does.
class OtherMeter implements Meter {
  public readonly label = "m2";
  public count = 100;
  public bump(): number {
    this.count += 10;
    return this.count;
  }
}
let swappable: Meter = new MeterImpl();
console.log("r07", swappable.label, swappable.bump());
swappable = new OtherMeter();
console.log("r08", swappable.label, swappable.bump());

// ------------------------------- 5. a cast whose target is a CLASS is NOT
// peeled: `live as Base` builds the upcast, so the value's class is Base's.
// The binding still aliases the one object -- what the peel must not do is
// claim the DERIVED class for a value the cast widened.
class Animal {
  public legs = 4;
}
class Dog extends Animal {
  public readonly bark = "woof";
}
interface HasLegs {
  legs: number;
}
const dog = new Dog();
const widened = dog as Animal;
const legsOnly: HasLegs = widened;
console.log("r09", legsOnly.legs, dog.bark);
dog.legs = 3;
console.log("r10", legsOnly.legs);

// --------------------------------------------- 6. inheritance through the
// annotation: the flattened instance-field map carries the base's members.
class Vehicle {
  public wheels = 4;
  public readonly kind = "vehicle";
}
class Car extends Vehicle {
  public doors = 5;
}
interface Wheeled {
  wheels: number;
  doors: number;
  readonly kind: string;
}
const car = new Car();
const wheeled: Wheeled = car;
console.log("r11", wheeled.wheels, wheeled.doors, wheeled.kind);
car.wheels = 6;
console.log("r12", wheeled.wheels);

// ------------------------- 7. a PRIVATE field reached through a file-scope
// cast, which is exactly what zapo's `client.writeBehind` is.
class Vault {
  private readonly secret = 41;
  public open(): number {
    return this.secret;
  }
}
const vault = new Vault();
const opened = vault as unknown as { secret: number };
console.log("r13", opened.secret, vault.open());

// ------------------------------------ 8. the binding still serves RECORD
// consumers: the projection route is what widthCoerce uses for those, and
// adopting the binding must not take that away.
function total(m: Meter): number {
  return m.count + m.bump();
}
console.log("r14", total(view), live.count);
const inArray: Meter[] = [view];
console.log("r15", inArray[0]!.count);
const inRecord: { it: Meter } = { it: view };
console.log("r16", inRecord.it.count, inRecord.it.label);

// ------------------------------------- 9. a composite field is not copied
class Bag {
  public readonly items: string[] = ["x"];
}
const bag = new Bag();
const bagView = bag as unknown as { items: string[] };
bagView.items.push("y");
console.log("r17", bag.items.length, bag.items.join(","), bagView.items.join(","));

// ------------------------------------------ 10. a `new` initializer at file
// scope is unchanged: collectGlobals already adopted it, and it must keep
// answering exactly as before.
const fresh: Meter = new MeterImpl();
console.log("r18", fresh.label, fresh.count, fresh.bump());
