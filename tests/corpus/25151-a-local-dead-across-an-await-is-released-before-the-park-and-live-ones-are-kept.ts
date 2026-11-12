// Locals the resume never reads again are released before the coroutine parks instead of riding the frame to function end.
// Every shape here keeps a value alive across an await by one route or another (a later read, an enclosing-expression read,
// a catch handler, a closure capture, a loop back edge) next to the shapes that may drop it; the printed sums and lengths
// are the same as Node's, and under --sanitize the RC audit sees no leak and no double release.

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function build(n: number, seed: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(i + seed);
  return a;
}

async function total(a: number[], tag: string): Promise<number> {
  await sleep(1);
  let s = tag.length;
  for (const v of a) s += v;
  return s;
}

function sumOf(xs: number[]): number {
  let s = 0;
  for (const v of xs) s += v;
  return s;
}

// 1. A local whose last use is the awaited call's argument.
async function deadAfterCall(): Promise<number> {
  const big = build(5000, 1);
  const r = await total(big, "one");
  return r;
}

// 2. The same local read again after the await: it must survive the park.
async function liveAfterCall(): Promise<number> {
  const big = build(300, 2);
  const r = await total(big, "two");
  return r + big.length + big[299];
}

// 3. The await nested in an enclosing expression: the local is read inside the operand AND outside it.
async function nestedBothSides(): Promise<number> {
  const xs = build(100, 3);
  return sumOf(xs) + (await total(xs, "x")) + xs.length;
}

// 4. The await nested in an enclosing expression, the local read only inside the operand.
async function nestedOnlyInside(): Promise<number> {
  const xs = build(2000, 4);
  return sumOf(build(10, 0)) + (await total(xs, "y"));
}

// 5. A parameter handed on and dropped.
async function paramDead(a: number[]): Promise<number> {
  return await total(a, "p");
}

// 6. A catch handler reads the local after a rejected await.
async function boom(a: number[]): Promise<number> {
  await sleep(1);
  if (a.length > 0) throw new Error("boom " + a.length);
  return 0;
}
async function handlerReads(): Promise<string> {
  const xs = build(7, 5);
  try {
    await boom(xs);
    return "no";
  } catch (e) {
    return (e as Error).message + ":" + xs.length;
  }
}

// 7. A closure captures the local; it is read after the park through the closure.
async function captured(): Promise<number> {
  const xs = build(40, 6);
  const get = (): number => xs.length;
  await sleep(1);
  return get() + (await total(xs, "c"));
}

// 8. A loop: the array is rebuilt each iteration, live across the await in one arm and dead in the other.
async function inLoop(): Promise<number> {
  let acc = 0;
  for (let i = 0; i < 6; i++) {
    const a = build(50 + i, i);
    if (i % 2 === 0) {
      acc += await total(a, "e");
      acc += a.length;
    } else {
      acc += await total(a, "o");
    }
  }
  return acc;
}

// 9. Assigned before the await, reassigned after it: the park drops the first value, the assignment installs the second.
async function reassigned(): Promise<number> {
  let xs = build(500, 7);
  const first = await total(xs, "r");
  xs = build(20, 8);
  return first + sumOf(xs);
}

// 10. A string and a nested array dropped across the await.
async function stringsAndNested(): Promise<number> {
  const label = "label-" + build(30, 0).length;
  const grid: number[][] = [];
  for (let i = 0; i < 20; i++) grid.push(build(i + 1, i));
  const r = await total(grid[19], label);
  return r + grid.length;
}

// 11. The value is handed to a runtime operation that stays pending while the await waits.
async function pendingRuntime(): Promise<number> {
  const xs = build(1000, 9);
  const ps: Promise<number>[] = [total(xs, "a"), total(xs, "b")];
  const parts = await Promise.all(ps);
  return parts[0] + parts[1];
}

async function main(): Promise<void> {
  console.log(await deadAfterCall());
  console.log(await liveAfterCall());
  console.log(await nestedBothSides());
  console.log(await nestedOnlyInside());
  console.log(await paramDead(build(1234, 1)));
  console.log(await handlerReads());
  console.log(await captured());
  console.log(await inLoop());
  console.log(await reassigned());
  console.log(await stringsAndNested());
  console.log(await pendingRuntime());
  const many: Promise<number>[] = [];
  for (let i = 0; i < 200; i++) many.push(deadAfterCall());
  const sums = await Promise.all(many);
  console.log(sums.length, sums[0], sums[199]);
}

main();
