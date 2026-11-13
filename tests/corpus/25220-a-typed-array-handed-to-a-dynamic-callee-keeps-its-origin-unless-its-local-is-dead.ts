// A typed array crossing into a dynamic value remembers what it was made from, so a write through the copy and a recovery of the original
// reach the object the program still names. When the local the array was read from is dead after the call, nothing can name the source and
// the compiler skips that bookkeeping (and frees the source early). Every case where something CAN still name it must behave exactly as
// before: a later read of the local, another variable or a container holding the same array, a closure that captured it, a loop that
// reads it again. Each is checked against Node, including writes through the copy and a recovery of the original.
type Keep = { copy: unknown };
const kept: Keep = { copy: undefined };
function consume(x: any): string {
  x.push(99);
  return JSON.stringify(x);
}
function keep(x: any): number {
  kept.copy = x;
  return x.length;
}

// 1. last use: the local is read once, by the crossing
{
  const a: number[] = [1, 2, 3];
  console.log("last-use", consume(a));
}
// 2. used after: the callee's write must be visible through the local (a write through the copy reaches its source)
{
  const a: number[] = [1, 2, 3];
  console.log("used-after", consume(a), JSON.stringify(a));
}
// 3. aliased through a container: the array has another owner, so its origin stays and the write is visible there
{
  const holder = { items: [10, 20] as number[] };
  const a = holder.items;
  console.log("aliased", consume(a), JSON.stringify(holder.items));
}
// 4. the callee keeps the copy; the source (reachable through the container) is written after the call and the copy is read later
{
  const holder = { items: [5, 6] as number[] };
  const a = holder.items;
  keep(a);
  holder.items.push(7);
  console.log("write-after", JSON.stringify(kept.copy), holder.items.length);
}
// 5. captured by a closure: the closure still names the array
{
  const a: number[] = [1, 2];
  const f = (): number => a.length;
  console.log("captured", consume(a), f());
}
// 6. loop: the array declared outside is read on every iteration; the one declared inside is a fresh local each time
{
  const outer: number[] = [0];
  for (let i = 0; i < 3; i++) console.log("loop-outer", i, consume(outer).length);
  for (let i = 0; i < 3; i++) {
    const inner: number[] = [i, i + 1];
    console.log("loop-inner", i, consume(inner));
  }
  console.log("loop-outer-after", JSON.stringify(outer));
}
// 6b. the loop reads the outer array and nothing else mentions it: each iteration's write through the copy must reach the array, because
// the next iteration reads it again (a crossing that skipped its origin would print [0,99] every time)
{
  const outerOnly: number[] = [0];
  for (let i = 0; i < 3; i++) console.log("loop-outer-only", i, consume(outerOnly));
}
{
  const outerWhile: number[] = [0];
  let n = 0;
  while (n < 3) {
    console.log("loop-while-only", n, consume(outerWhile));
    n++;
  }
}
// 7. recovery: the dyn copy comes back typed
function through(x: any): any {
  return x;
}
{
  const a: string[] = ["x", "y"];
  const back = through(a) as string[];
  back.push("z");
  console.log("recovered", back.length, back.join(","));
}
{
  const a: string[] = ["p", "q"];
  const back = through(a) as string[];
  back.push("r");
  console.log("recovered-used-after", back === a, a.length, a.join(","));
}
// 8. across a suspension: the callee is pending while the call's frame is parked; many pending at once
const gate = new Promise<void>((r) => {
  setTimeout(r, 5);
});
async function pending(tag: string, values: any): Promise<string> {
  await gate;
  return tag + ":" + values.length;
}
async function caller(i: number): Promise<string> {
  const params: (string | number | null)[] = ["s" + i];
  for (let k = 0; k < 40; k++) params.push(k % 3 === 0 ? null : k % 2 === 0 ? -1 : "");
  return await pending("q" + i, params);
}
async function main(): Promise<void> {
  const all: Promise<string>[] = [];
  for (let i = 0; i < 5; i++) all.push(caller(i));
  console.log((await Promise.all(all)).join(" "));
  const used: (string | number | null)[] = ["u", 1, null];
  const p = pending("used", used);
  used.push("later");
  console.log(await p, used.length);
}
main();
