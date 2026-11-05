// Reactions registered on a promise run in registration order. The claim over an untyped-JS promise is that same promise in
// Node, so a reaction registered through the claim sits between the ones registered on the source, whatever their kind.
import { pend, watchAwait, watchThen, release } from "twinrec/claim";
async function main(): Promise<void> {
  const log: string[] = [];
  const l = (s: string): void => {
    log.push(s);
  };
  const claim = pend(l);
  claim.then(() => l("claim-then-1"));
  watchAwait(l);
  void (async () => {
    await claim;
    l("claim-await");
  })();
  Promise.all([claim]).then(() => l("claim-all"));
  watchThen(l);
  claim.then(() => l("claim-then-2"));
  release(1);
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  console.log(log.join("\n"));
}
void main();
