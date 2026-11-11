// A synchronous recursion thousands of frames deep inside an async generator body, run both before and after an await and resumed from a later
// request: the body's own call depth must not depend on how the generator is suspended.
function depth(n: number, acc: number): number {
  if (n === 0) return acc;
  return depth(n - 1, acc + (n % 3)) + 1;
}
async function* g(n: number): AsyncGenerator<number, number, void> {
  yield depth(n, 0);
  await new Promise<void>((r) => setTimeout(r, 1));
  yield depth(n * 2, 1);
  await null;
  return depth(n, 2);
}
async function main(): Promise<void> {
  const out: number[] = [];
  for await (const v of g(2000)) out.push(v);
  const it = g(1500);
  out.push((await it.next()).value as number);
  out.push((await it.next()).value as number);
  const last = await it.next();
  out.push(last.value as number, last.done === true ? 1 : 0);
  console.log(out.join(","));
}
main();
