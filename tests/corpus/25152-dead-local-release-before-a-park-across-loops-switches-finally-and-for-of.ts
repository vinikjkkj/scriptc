// The release of a local that is dead across an await, in the control-flow shapes where "dead" is easy to get wrong: a
// stale slot from a previous loop iteration, a switch case entered past an earlier case's declaration, a finally body
// that reads the local, a for-of binding, a labeled block, and a local first assigned after the await. Node's output is
// the oracle on both backends; under --sanitize the RC audit would see any leak or double release.

function tick(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
function mk(n: number, k: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(i * k);
  return a;
}
async function eat(a: number[]): Promise<number> {
  await tick();
  return a.length;
}

// The await comes BEFORE the declaration in the loop body: the slot holds the previous iteration's (released) array.
async function awaitBeforeDecl(): Promise<number> {
  let acc = 0;
  for (let i = 0; i < 5; i++) {
    await tick();
    const a = mk(10 + i, 2);
    acc += a.length;
  }
  return acc;
}

// Declared in one switch case, the await in another reached by a jump past the declaration.
async function switchCases(k: number): Promise<number> {
  let acc = 0;
  for (let round = 0; round < 3; round++) {
    switch ((k + round) % 3) {
      case 0: {
        const first = mk(5, 1);
        acc += first.length;
        break;
      }
      case 1: {
        const second = mk(6, 1);
        acc += await eat(second);
        break;
      }
      default:
        acc += await eat(mk(7, 1));
    }
  }
  return acc;
}

// A finally body reads the local after the try body awaited.
async function finallyReads(): Promise<string> {
  const xs = mk(9, 3);
  const log: string[] = [];
  try {
    log.push("body:" + (await eat(xs)));
  } finally {
    log.push("finally:" + xs.length + ":" + xs[8]);
  }
  return log.join(",");
}

// An await inside the finally body, the local dead afterwards.
async function awaitInFinally(): Promise<number> {
  let r = 0;
  try {
    r = 1;
  } finally {
    const tmp = mk(33, 1);
    r += await eat(tmp);
  }
  return r;
}

// A for-of binding that is an array: dead after its last use in the iteration, live when read after the await.
async function forOfBindings(): Promise<number> {
  const rows: number[][] = [mk(2, 1), mk(3, 1), mk(4, 1)];
  let acc = 0;
  for (const row of rows) {
    acc += await eat(row);
    acc += row.length;
  }
  for (const row of rows) {
    acc += await eat(row);
  }
  return acc;
}

// A labeled block with a break around an await.
async function labeled(flag: boolean): Promise<number> {
  let acc = 0;
  outer: {
    const a = mk(4, 1);
    if (flag) break outer;
    acc += await eat(a);
    acc += 100;
  }
  return acc + (flag ? 1 : 2);
}

// A local first assigned after the await.
async function lateAssign(): Promise<number> {
  let late: number[] | null = null;
  const before = await eat(mk(3, 1));
  late = mk(11, 1);
  return before + late.length;
}

// A local that is read in a later iteration through the loop back edge, so it stays live across the await.
async function backEdge(): Promise<number> {
  let carry: number[] = mk(2, 1);
  let acc = 0;
  for (let i = 0; i < 4; i++) {
    acc += carry.length;
    await tick();
    carry = mk(2 + i, 1);
  }
  return acc + carry.length;
}

// Many frames at once, each dropping its array at its await.
async function crowd(): Promise<number> {
  const ps: Promise<number>[] = [];
  for (let i = 0; i < 300; i++) ps.push(eat(mk(100 + (i % 7), 1)));
  const out = await Promise.all(ps);
  let s = 0;
  for (const v of out) s += v;
  return s;
}

async function main(): Promise<void> {
  console.log(await awaitBeforeDecl());
  console.log(await switchCases(0), await switchCases(1), await switchCases(2));
  console.log(await finallyReads());
  console.log(await awaitInFinally());
  console.log(await forOfBindings());
  console.log(await labeled(true), await labeled(false));
  console.log(await lateAssign());
  console.log(await backEdge());
  console.log(await crowd());
}

main();
