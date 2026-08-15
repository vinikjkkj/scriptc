// The WRITE half of the adoption rule's promise.
//
// The rule's own comment says an adopted binding's members "read as the
// class's own". Its READ half is kept by a rescue at lowerFieldRead's
// last-resort fence and its CALL half by one at lowerObjectMethodCall's --
// 3731 and 3732 pin those. The WRITE half never was: fieldTarget resolves the
// member against the CHECKER's type, sees the binding's declared record, and
// declines the moment the lowered receiver turns out to be an object. Nothing
// downstream claims a declined property write, so `x.v = 1` through an
// adopted binding fell all the way to SC1090 "assignment to non-variables" --
// at BOTH scopes, on the very shape the rule was written for.
//
// The rescue sits where that decline is, so only a site that fences today can
// reach it, and it draws the read rescue's line: the flattened instance-field
// map (inherited members included) is the authority, an accessor-satisfied
// name has no data slot and a method name is a bound reference, so both keep
// the older fences. The node it builds is the same fieldSet a method body's
// own `this.v = e` emits.
//
// Compound assignment, `++` and `--` ride with it: lowerFieldCompound asks
// the same fieldTarget, so they were the same fence and are the same rescue.
//
// What deliberately still fences, and so cannot appear here:
//   - a write through an ACCESSOR-satisfied name (the setter dispatch owns
//     the slot; a raw fieldSet would write past it).
//   - a write of a value the CLASS's slot cannot hold, where the checker's
//     member type is wider than the class's own (`n: number | string` over
//     `n: number`): the value coercion fences, which is the honest answer for
//     a slot that has no representation for it.

interface Meter {
  readonly label: string;
  count: number;
}

class MeterImpl implements Meter {
  public readonly label = "m1";
  public count = 0;
}

// -------------------------------------------- 1. the write at BLOCK scope,
// where lowerVarDecl's adoption chain runs. This fenced on the base compiler.
{
  const live = new MeterImpl();
  const view: Meter = live;
  view.count = 7;
  console.log("r01", live.count, view.count);
}

// ------------------------------------------------ 2. ...and at FILE scope.
const live = new MeterImpl();
const view: Meter = live;
view.count = 11;
console.log("r02", live.count, view.count);

// ------------------------------------------------- 3. the CAST spelling --
// zapo's -- reaching a PRIVATE field, written and read back through the
// class's own method.
class Vault {
  private secret = 1;
  public open(): number {
    return this.secret;
  }
}
const vault = new Vault();
const opened = vault as unknown as { secret: number };
opened.secret = 41;
console.log("r03", vault.open(), opened.secret);

// -------------------------------------- 4. compound assignment, ++ and --
{
  const c = new MeterImpl();
  const v: Meter = c;
  v.count += 4;
  console.log("r04", c.count);
  v.count++;
  console.log("r05", c.count);
  v.count *= 3;
  console.log("r06", c.count);
  v.count--;
  console.log("r07", c.count);
  --v.count;
  console.log("r08", c.count, v.count);
}

// ------------------------------------------ 5. an INHERITED field, written
// through the adopted binding at both scopes.
class Vehicle {
  public wheels = 4;
}
class Car extends Vehicle {
  public doors = 5;
}
interface Wheeled {
  wheels: number;
  doors: number;
}
const car = new Car();
const wheeled: Wheeled = car;
wheeled.wheels = 6;
wheeled.doors = 3;
console.log("r09", car.wheels, car.doors);
{
  const car2 = new Car();
  const w2: Wheeled = car2;
  w2.wheels = 8;
  console.log("r10", car2.wheels, w2.wheels);
}

// --------------------------------- 6. a STRING field, so the rescue is not
// quietly numeric-only, and a composite field REPLACED rather than mutated.
class Label {
  public text = "a";
  public parts: string[] = ["p"];
}
interface Labelled {
  text: string;
  parts: string[];
}
{
  const l = new Label();
  const lv: Labelled = l;
  lv.text = "b";
  lv.parts = ["q", "r"];
  console.log("r11", l.text, l.parts.join(","), lv.parts.length);
  lv.text += "c";
  console.log("r12", l.text);
}

// ----------------------------- 7. the write does not disturb the read or
// the call: all three halves through the SAME binding, interleaved.
class Counter {
  public n = 0;
  public bump(): number {
    this.n += 1;
    return this.n;
  }
}
interface Countable {
  n: number;
  bump(): number;
}
{
  const c = new Counter();
  const v: Countable = c;
  console.log("r13", v.bump(), v.n);
  v.n = 10;
  console.log("r14", v.bump(), c.n);
  v.n += v.bump();
  console.log("r15", c.n, v.n);
}

// ------------------------------- 8. the write reaches through a two-step
// chain, which is the shape zapo's `wb.writeBehind` is.
class Inner {
  public v = 1;
}
class Outer {
  private readonly inner: Inner = new Inner();
  public peek(): number {
    return this.inner.v;
  }
}
const outer = new Outer();
const reach = outer as unknown as { inner: { v: number } };
reach.inner.v = 99;
console.log("r16", outer.peek(), reach.inner.v);
