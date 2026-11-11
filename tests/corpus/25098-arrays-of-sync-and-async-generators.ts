// Arrays whose elements are generator handles (sync and async): built by push and by literal, indexed, iterated, and advanced round-robin.
async function* counter(id: number): AsyncGenerator<number, number, void> {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
    s += id + i;
    yield s;
  }
  return s * 2;
}
function* range(n: number): Generator<number, void, void> {
  for (let i = 0; i < n; i++) yield i;
}
async function main(): Promise<void> {
  const gens: AsyncGenerator<number, number, void>[] = [];
  for (let i = 0; i < 4; i++) gens.push(counter(i));
  const out: number[] = [];
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < gens.length; i++) {
      const r = await gens[i]!.next();
      out.push(r.done === true ? -1 : (r.value as number));
    }
  }
  console.log(out.join(","));
  const list: Generator<number, void, void>[] = [range(2), range(3)];
  list.push(range(1));
  let t = 0;
  for (const g of list) for (const v of g) t += v + 1;
  console.log(list.length, t);
  const first: AsyncGenerator<number, number, void> = gens[0]!;
  console.log((await first.next()).done);
}
main();
