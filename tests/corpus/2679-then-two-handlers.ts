// `p.then(onFulfilled, onRejected)`. NOT `.then(f).catch(r)`: there r would
// also see whatever f threw, while the spec routes only the RECEIVER's
// rejection to it -- so only the await sits in the try, and the fulfillment
// handler runs after it. The last case is what pins that difference.
//
// The rejection reason arrives as a checked-dynamic value, which is what a
// caught value IS; narrowing it to a declared parameter type would be a cast
// nobody wrote.
const noop = (): void => {};

async function main(): Promise<void> {
  const ok = Promise.resolve(7);
  const bad: Promise<number> = Promise.reject(new Error("nope"));

  console.log(await ok.then((v) => v + 1, () => -1));
  console.log(await bad.then((v) => v + 1, () => -1));
  // The rejection reason arrives as a checked-dynamic value.
  console.log(await bad.then((v) => `${v}`, (e) => (e instanceof Error ? e.message : "?")));
  // Zero-parameter handlers, the tracker idiom.
  await ok.then(noop, noop);
  await bad.then(noop, noop);
  console.log("trackers ok");
  // A THROW from the fulfillment handler must NOT reach the rejection
  // handler -- that is the whole difference from .then(f).catch(r).
  try {
    await ok.then((): string => { throw new Error("from f"); }, () => "r ran");
    console.log("no throw");
  } catch (e) {
    console.log("caught", e instanceof Error ? e.message : "?");
  }
}
void main();
