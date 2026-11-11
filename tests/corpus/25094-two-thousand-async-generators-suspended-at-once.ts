// 2000 async generators suspended at the same time (each parked on one shared promise, then at a yield), advanced by 2000 concurrent
// consumers: every one keeps its own state across the interleaving.
let release: () => void = () => {};
const gate = new Promise<void>((r) => { release = r; });
async function* counter(id: number): AsyncGenerator<number, number, void> {
  let s = 0;
  await gate;
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    s += id + i;
    yield s;
  }
  return s * 2;
}
async function consume(id: number): Promise<number> {
  let t = 0;
  const g = counter(id);
  let r = await g.next();
  while (r.done !== true) {
    t += r.value as number;
    r = await g.next();
  }
  return t + (r.value as number);
}
async function main(): Promise<void> {
  const ps: Promise<number>[] = [];
  for (let i = 0; i < 2000; i++) ps.push(consume(i));
  await new Promise<void>((r) => setTimeout(r, 5));
  release();
  const rs = await Promise.all(ps);
  let total = 0;
  for (const r of rs) total += r;
  console.log("total", rs.length, total);
}
main();
