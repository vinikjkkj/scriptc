// The MICROTASK ORDERING of async generators, pinned against Node.
//
// This is the assertion most likely to go silently wrong: a generator can
// deliver every value correctly and still resume a turn early or a turn
// late, which is invisible to any test that only prints the values. So the
// program races generator delivery against an independent chain of promise
// jobs and prints the interleaving.
//
// Two facts it pins, both measured from Node rather than assumed:
//   - the body runs SYNCHRONOUSLY inside the first resume, so its first
//     line lands before any microtask and before the code that follows the
//     call to main();
//   - one turn of `for await` over a generator costs exactly ONE microtask
//     turn more than awaiting a plain async call, because JS awaits the
//     yielded operand (AsyncGeneratorYield) before answering the request.
function chain(n: number): void {
  let p = Promise.resolve();
  for (let i = 1; i <= n; i++) {
    const k = i;
    p = p.then(() => {
      console.log("t" + k);
    });
  }
}

async function* gen(): AsyncGenerator<number, void, void> {
  console.log("gen: body entered");
  yield 1;
  yield 2;
}

async function plain(v: number): Promise<number> {
  return v;
}

async function generatorLane(): Promise<void> {
  chain(10);
  for await (const v of gen()) console.log("gen got", v);
}

async function plainLane(): Promise<void> {
  chain(10);
  console.log("plain got", await plain(1));
  console.log("plain got", await plain(2));
}

// A yielded value that is itself produced by an await keeps the same
// per-turn cost: the await is the body's, the hop is the yield's. At module
// scope because a nested `async function*` keeps its SC1071 refusal.
async function* mixed(): AsyncGenerator<number, void, void> {
  const a = await plain(10);
  yield a;
  yield 20;
}

async function main(): Promise<void> {
  await generatorLane();
  console.log("=== generator lane done");
  await plainLane();
  console.log("=== plain lane done");

  chain(6);
  for await (const v of mixed()) console.log("mixed", v);
}

main();
console.log("sync: after main()");
