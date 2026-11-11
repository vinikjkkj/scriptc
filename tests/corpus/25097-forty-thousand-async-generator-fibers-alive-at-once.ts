// 20000 async-generator consumers parked on one promise keep 40000 coroutine fibers alive at once. Every fiber stack used to be its own guarded
// mapping (two kernel mappings each), so past about 32700 live fibers the default vm.max_map_count of 65530 was exhausted and the process died with
// "out of memory" where Node runs this fine.
let release: () => void = () => {};
const gate = new Promise<void>((r) => { release = r; });
async function* gen(i: number) {
  await gate;
  yield i;
  yield i + 1;
}
async function consume(i: number): Promise<number> {
  let s = 0;
  for await (const v of gen(i)) s += v;
  return s;
}
async function main() {
  const ps: Promise<number>[] = [];
  for (let i = 0; i < 20000; i++) ps.push(consume(i));
  await new Promise<void>((r) => setTimeout(r, 20));
  release();
  const rs = await Promise.all(ps);
  let t = 0;
  for (const r of rs) t += r;
  console.log("total", rs.length, t);
}
main();
