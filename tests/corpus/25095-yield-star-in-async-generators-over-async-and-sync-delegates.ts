// yield* inside async generators: delegating to an async generator and to a sync generator, interleaved with a plain microtask chain, with
// return() closing the delegate (its finally runs), throw() forwarded into the delegate (caught by the outer, or propagating out of a sync delegate).
const log: string[] = [];
function chain(tag: string, n: number): void {
  let p: Promise<void> = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => { log.push(`${tag}${i}`); });
}
async function* inner(tag: string): AsyncGenerator<number, string, void> {
  try {
    log.push(`${tag}:start`);
    yield 1;
    log.push(`${tag}:got1`);
    await Promise.resolve();
    yield 2;
    log.push(`${tag}:got2`);
    return `${tag}:ret`;
  } finally {
    log.push(`${tag}:finally`);
  }
}
function* syncInner(): Generator<number, void, void> {
  try {
    yield 10;
    log.push("sync:got");
    yield 20;
  } finally {
    log.push("sync:finally");
  }
}
async function* outer(): AsyncGenerator<number, void, void> {
  yield* inner("a");
  log.push("outer:after a");
  yield* syncInner();
  log.push("outer:after sync");
}
async function* catcher(): AsyncGenerator<number, void, void> {
  try {
    yield* inner("c");
  } catch (e) {
    log.push(`catcher caught ${String(e)}`);
    yield 99;
  }
}
async function main(): Promise<void> {
  chain("m", 12);
  const o = outer();
  let r = await o.next();
  while (r.done !== true) {
    log.push(`main:${r.value}`);
    r = await o.next();
  }
  const o2 = outer();
  log.push(JSON.stringify(await o2.next()));
  log.push(JSON.stringify(await o2.return()));
  log.push(JSON.stringify(await o2.next()));
  const c = catcher();
  log.push(JSON.stringify(await c.next()));
  log.push(JSON.stringify(await c.throw(new Error("boom"))));
  log.push(JSON.stringify(await c.next()));
  const d = outer();
  await d.next();
  await d.next();
  await d.next();
  try {
    await d.throw(new Error("into-sync"));
  } catch (e) {
    log.push(`d threw ${String(e)}`);
  }
  console.log(log.join("\n"));
}
main();
