/* `new Promise<never>` — the natural type for a promise that only ever
 * REJECTS (a timeout, a child-process failure racing a real result) — ICEs
 * the lowering: Promise<never> takes the void payload path, so the emitted
 * `newPromise<void>` accepts no resolve argument, while the executor it was
 * handed still declares one.
 *
 * Node runs this program and prints `caught boom`, so the shape is ordinary
 * JavaScript, not an exotic corner. It is pinned HERE rather than in the
 * corpus because the corpus requires a program that compiles and matches
 * Node byte for byte, and this one does not compile at all — when the ICE
 * is fixed, this fixture is what fails, and the right move then is to
 * promote it to a corpus program with node's `caught boom` as the oracle.
 *
 * Found while porting the messaging bench's control channel off fork(): the
 * parent races a connection against a child-failure promise and a timeout,
 * and both of the latter are Promise<never>. The workaround there is to
 * type them Promise<void> and never resolve them.
 */
async function main(): Promise<void> {
  const boom = new Promise<never>((_resolve, reject) => {
    setTimeout(() => { reject(new Error('boom')) }, 1);
  });
  try {
    await boom;
  } catch (e) {
    console.log('caught', (e as Error).message);
  }
}
void main();
