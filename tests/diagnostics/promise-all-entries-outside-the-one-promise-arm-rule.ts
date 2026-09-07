/* The heterogeneous `Promise.all` entries the maybe-arm rule deliberately
 * does NOT claim, pinned from outside so the boundary is tested by what it
 * refuses.
 *
 * The rule it does claim: an entry may be a TWO-ARM union with EXACTLY ONE
 * promise arm, and the other arm may be anything static -- a unit (corpus
 * 3203) or a value (corpus 7790). The adapter branches on the tag, awaits
 * the promise arm and RETURNS the other one, which is exactly what
 * `Promise.all` does with a non-promise entry.
 *
 * THREE ARMS (`Promise<T> | null | undefined`) is an under-approximation
 * and is recorded as one rather than left to look like an oversight: the
 * tag test is still decidable, but the non-promise side would have to
 * switch over the remaining arms instead of returning the one, and nothing
 * in the corpus or in zapo writes it.
 *
 * A DYN arm is refused for a reason of its own, and this one is not a
 * conservatism. `Promise.all` ADOPTS a thenable entry rather than passing
 * it through, and only a STATIC type can rule out that the value is one --
 * an `any` arm carries whatever it carries. For a static arm the checker
 * rules it out for us: `Awaited<V>` unwraps a thenable V, so a thenable arm
 * makes the payload the form computes stop matching the checker's own tuple
 * field, and the form declines before it builds anything.
 *
 * A TUPLE VALUE from elsewhere keeps the fence too, for a third reason: the
 * entries are read off the LOWERED LITERAL so that nothing is evaluated
 * twice, and a tuple that arrived as a value has no literal to read. Its
 * hint is the annotate-the-array one, which is the fix that actually works
 * there.
 *
 * TWO PROMISE ARMS -- the shape the "exactly one promise arm" wording
 * excludes -- is NOT pinned here, because it cannot be spelled: the type
 * mapper answers `Promise<A> | Promise<B>` with one promise arm over a
 * union payload, so such an entry arrives as an ordinary promise and
 * compiles. The guard in the lowering is defensive against a union built by
 * some other route, not a refusal a program can reach. */

type A = { readonly a: number };
type B = { readonly b: string };

async function loadA(): Promise<A> {
  return { a: 1 };
}
async function loadB(): Promise<B> {
  return { b: "b" };
}

// THREE arms: one promise and two units.
async function threeArms(entry: Promise<A> | null | undefined): Promise<void> {
  const [x, y] = await Promise.all([entry, loadB()]);
  console.log(x, y.b);
}

// A DYN arm: nothing static rules out that the value is a thenable, and
// `Promise.all` would adopt it rather than pass it through.
async function dynArm(entry: Promise<A> | any): Promise<void> {
  const [x, y] = await Promise.all([entry, loadB()]);
  console.log(x, y.b);
}

// A tuple VALUE rather than a literal at the call site.
async function fromATupleValue(): Promise<void> {
  const jobs: [Promise<A>, Promise<B>] = [loadA(), loadB()];
  const [x, y] = await Promise.all(jobs);
  console.log(x.a, y.b);
}

void threeArms(null);
void dynArm(loadA());
void fromATupleValue();
