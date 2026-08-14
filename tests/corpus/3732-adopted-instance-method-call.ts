// A METHOD CALL through a binding whose value is a class instance, where the
// checker spells a structural record.
//
// This is zapo's `wb.writeBehind.flush(2000)`, in miniature. The client is
// cast (`client as unknown as { writeBehind: { flush(ms: number): Promise<R> } }`),
// the cast ERASES to the same instance, and lowerVarDecl's adoption rule
// keeps that instance in the const. lowerObjectMethodCall already rescues
// such a receiver -- but through exactInstanceClassOf, which reads the SYNTAX
// (a const initialized by a direct `new`), so a CAST-initialized binding and
// a field read off one were invisible to it and both took the last-resort
// SC1090 "method calls like 'wb.writeBehind.flush'".
//
// Asking the LOWERED VALUE instead answers both, and it answers them
// NOMINALLY: the call is the class's own method on the real instance, not a
// closure over a projected copy. Three consequences are pinned below.
//
//   1. r03/r04 -- a DEFAULT-valued parameter (`flush(ms: number = this.d)`)
//      satisfies a target signature that declares the parameter REQUIRED.
//      This is the clause that made the record route decline: the method's
//      IR parameter is `number | undefined` while the target field says
//      `number`, and ctorWitnessProjection's per-position typeEquals refuses
//      it. Nothing needs to widen here -- the real method is called.
//   2. r06 -- `this` is the live instance, so a mutation the method makes is
//      visible through the class binding afterwards.
//   3. r07 -- an OVERRIDE below the receiver's static class still dispatches
//      dynamically: the rescue hands lowerObjectMethodCall a class name and
//      the ordinary devirtualization rules run unchanged.
//
// The receiver probe is restricted to a PLAIN READ CHAIN (an identifier, or a
// dotted chain of names rooted at one), because it lowers the receiver a
// second time and only a side-effect-free read may be re-emitted. A call in
// receiver position keeps the fence and cannot appear here.

export {};

interface DrainCount {
  readonly flushed: number;
  readonly remaining: number;
}

interface DrainResult {
  readonly messages: DrainCount;
  readonly contacts: DrainCount;
  readonly flushed: number;
  readonly remaining: number;
}

class WriteBehind {
  private queued = 0;
  private readonly defaultTimeoutMs = 5_000;
  public persist(): void {
    this.queued += 1;
  }
  // The zapo signature: a DEFAULT-valued parameter, which types as optional.
  public async flush(timeoutMs: number = this.defaultTimeoutMs): Promise<DrainResult> {
    const flushed = this.queued;
    this.queued = 0;
    return {
      messages: { flushed, remaining: 0 },
      contacts: { flushed, remaining: 0 },
      flushed: flushed + (timeoutMs > 1_000 ? 0 : 100),
      remaining: 0,
    };
  }
}

class Client {
  private readonly writeBehind: WriteBehind = new WriteBehind();
  public take(): void {
    this.writeBehind.persist();
  }
}

const client = new Client();
client.take();
client.take();

// ------------------------------------- 1. the two-step chain, zapo's shape
{
  const wb = client as unknown as {
    writeBehind: {
      flush(timeoutMs: number): Promise<{
        readonly messages: { readonly flushed: number; readonly remaining: number };
        readonly contacts: { readonly flushed: number; readonly remaining: number };
        readonly flushed: number;
        readonly remaining: number;
      }>;
    };
  };
  const drain = await wb.writeBehind.flush(2_000);
  console.log("r01", drain.messages.flushed, drain.contacts.flushed);
  console.log("r02", drain.flushed, drain.remaining);
}

// ------------------------- 2. the default-valued parameter, both directions
class Timer {
  public readonly base = 10;
  public tick(step: number = 7): number {
    return this.base + step;
  }
}
{
  const t = new Timer() as unknown as { tick(step: number): number };
  console.log("r03", t.tick(1), t.tick(2));
}
{
  // The same method reached through a target that declares the parameter
  // OPTIONAL: the default fires.
  const t2 = new Timer() as unknown as { tick(step?: number): number };
  console.log("r04", t2.tick(), t2.tick(3));
}

// --------------------------------------- 3. an identifier receiver, no chain
class Greeter {
  public readonly who: string;
  public constructor(who: string) {
    this.who = who;
  }
  public hi(): string {
    return "hi " + this.who;
  }
}
{
  const g = new Greeter("wb") as unknown as { hi(): string };
  console.log("r05", g.hi());
}

// ------------------------------------------------ 4. `this` is the instance
class Ledger {
  public total = 0;
  public add(n: number): number {
    this.total += n;
    return this.total;
  }
}
{
  const ledger = new Ledger();
  const view = ledger as unknown as { add(n: number): number };
  console.log("r06a", view.add(2), view.add(3));
  console.log("r06b", ledger.total);
}

// ------------------------------------------- 5. an override still dispatches
class Animal {
  public speak(): string {
    return "generic";
  }
}
class Dog extends Animal {
  public override speak(): string {
    return "woof";
  }
}
{
  const a: Animal = new Dog();
  const v = a as unknown as { speak(): string };
  console.log("r07", v.speak(), new Animal().speak());
}

// ------------------------------------ 6. the annotation spelling, both scopes
interface Speaks {
  speak(): string;
}
const named: Speaks = new Dog();
console.log("r08", named.speak());
{
  const inner: Speaks = new Animal();
  console.log("r09", inner.speak());
}
