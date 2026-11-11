// Early exit from an async generator: break out of for-await runs its finally, return() unwinds through try/finally (the finally may await and
// yield), throw() lands in a try/catch around the yield, a throw out of the body rejects the request, and a finished generator answers done.
const log: string[] = [];
async function* g1(): AsyncGenerator<number, string, void> {
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally {
    log.push("g1:finally");
    await Promise.resolve();
    log.push("g1:finally-after-await");
  }
  return "g1:never";
}
async function* g2(): AsyncGenerator<number, number, void> {
  try {
    yield 1;
  } catch (e) {
    log.push(`g2:caught ${String(e)}`);
    yield 100;
  }
  try {
    yield 2;
  } finally {
    log.push("g2:finally");
    yield 99; // a finally that yields
  }
  return 7;
}
async function* g3(): AsyncGenerator<number, void, void> {
  yield 1;
  await Promise.resolve();
  throw new Error("g3:boom");
}
async function* g4(): AsyncGenerator<number, string, number> {
  let i = 0;
  while (true) {
    const sent = yield i++;
    log.push(`g4:sent ${String(sent)}`);
  }
}
async function main(): Promise<void> {
  for await (const v of g1()) {
    log.push(`loop1:${v}`);
    if (v === 2) break;
  }
  const a = g1();
  log.push(JSON.stringify(await a.next()));
  log.push(JSON.stringify(await a.return("early")));
  log.push(JSON.stringify(await a.next()));
  const b = g2();
  log.push(JSON.stringify(await b.next()));
  log.push(JSON.stringify(await b.throw(new Error("into-b"))));
  log.push(JSON.stringify(await b.next()));
  log.push(JSON.stringify(await b.return(5)));
  log.push(JSON.stringify(await b.next()));
  log.push(JSON.stringify(await b.next()));
  const c = g3();
  try {
    for await (const v of c) log.push(`loop3:${v}`);
  } catch (e) {
    log.push(`loop3 rejected: ${(e as Error).message}`);
  }
  log.push(JSON.stringify(await c.next()));
  const d = g4();
  log.push(JSON.stringify(await d.next(0)));
  log.push(JSON.stringify(await d.next(10)));
  log.push(JSON.stringify(await d.return("stop")));
  const u = g1();
  log.push(JSON.stringify(await u.return("never-started")));
  const w = g1();
  try {
    await w.throw(new Error("never-started-throw"));
  } catch (e) {
    log.push(`w threw ${(e as Error).message}`);
  }
  console.log(log.join("\n"));
}
main();
