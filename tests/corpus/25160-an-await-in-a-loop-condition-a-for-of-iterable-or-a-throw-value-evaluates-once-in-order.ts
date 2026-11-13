// Awaits in statement headers: the for-of iterable, the condition of while / do-while / for, a throw value, and a keyed store's
// operands. Each is evaluated exactly once per pass and in source order, `continue` of a do-while still reaches its condition, and a
// labeled continue re-evaluates the condition. Node is the oracle on both backends, plain and sanitized.

const log: string[] = [];
function note(s: string): void {
  log.push(s);
}
function tick(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 0));
}
async function val(n: number, tag: string): Promise<number> {
  await tick();
  note(tag + n);
  return n;
}
async function flag(b: boolean, tag: string): Promise<boolean> {
  await Promise.resolve();
  note(tag + (b ? "T" : "F"));
  return b;
}

async function forOfIterable(): Promise<number> {
  let s = 0;
  for (const v of await Promise.all([val(1, "a"), val(2, "b"), val(3, "c")])) s += v;
  return s;
}

async function whileCond(): Promise<number> {
  let i = 0;
  while (await flag(i < 3, "w")) {
    i++;
    if (i === 2) continue;
    note("body" + i);
  }
  return i;
}

async function doWhileCond(): Promise<number> {
  let i = 0;
  do {
    i++;
    if (i === 2) continue;
    note("dw" + i);
  } while (await flag(i < 4, "d"));
  return i;
}

async function forCond(): Promise<number> {
  let s = 0;
  for (let i = 0; await flag(i < 3, "f"); i++) s += i;
  return s;
}

async function labeled(): Promise<number> {
  let n = 0;
  outer: for (let i = 0; i < 3; i++) {
    let j = 0;
    while (await flag(j < 3, "l" + i)) {
      j++;
      if (j === 2) continue outer;
      n++;
    }
  }
  return n;
}

async function throwAwait(): Promise<string> {
  try {
    throw await val(7, "t");
  } catch (e) {
    return "caught " + String(e);
  }
}

async function breakInWhile(): Promise<number> {
  let i = 0;
  while (await flag(true, "b")) {
    if (++i === 3) break;
  }
  return i;
}

async function main(): Promise<void> {
  console.log(await forOfIterable(), log.join(","));
  log.length = 0;
  console.log(await whileCond(), log.join(","));
  log.length = 0;
  console.log(await doWhileCond(), log.join(","));
  log.length = 0;
  console.log(await forCond(), log.join(","));
  log.length = 0;
  console.log(await labeled(), log.join(","));
  log.length = 0;
  console.log(await throwAwait(), log.join(","));
  log.length = 0;
  console.log(await breakInWhile(), log.join(","));
}
main();
