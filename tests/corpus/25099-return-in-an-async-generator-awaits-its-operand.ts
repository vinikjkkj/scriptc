// `return e;` in an async generator awaits e (one microtask turn) before the completion settles the request and before a finally runs; a bare
// `return;` and falling off the end do not. The turn shows up as the position of the independent microtask chain's lines.
const log: string[] = [];
function chain(tag: string, n: number): void {
  let p: Promise<void> = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => { log.push(`${tag}${i}`); });
}
async function* withValue(): AsyncGenerator<number, string, void> {
  try {
    yield 1;
    return "value";
  } finally {
    log.push("withValue:finally");
  }
}
async function* bare(): AsyncGenerator<number, void, void> {
  try {
    yield 1;
    return;
  } finally {
    log.push("bare:finally");
  }
}
async function* offEnd(): AsyncGenerator<number, void, void> {
  try {
    yield 1;
  } finally {
    log.push("offEnd:finally");
  }
}
async function main(): Promise<void> {
  chain("a", 8);
  const v = withValue();
  await v.next();
  log.push(JSON.stringify(await v.next()));
  chain("b", 8);
  const b = bare();
  await b.next();
  log.push(JSON.stringify(await b.next()));
  chain("c", 8);
  const o = offEnd();
  await o.next();
  log.push(JSON.stringify(await o.next()));
  console.log(log.join("\n"));
}
main();
