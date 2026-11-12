// A pending promise parks its first awaiter inline and the second onwards in a vector;
// every count must wake in registration order, and `.then` callbacks, Promise.all/race
// entries and awaiters on the SAME promise must replay in the order they registered.
const log: string[] = [];

function defer(): { p: Promise<number>; ok: (v: number) => void; no: (e: unknown) => void } {
  let ok!: (v: number) => void;
  let no!: (e: unknown) => void;
  const p = new Promise<number>((a, b) => {
    ok = a;
    no = b;
  });
  return { p, ok, no };
}

async function waiter(tag: string, p: Promise<number>): Promise<number> {
  const v = await p;
  log.push(tag + "=" + v);
  return v;
}

async function settleAfter(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

async function main(): Promise<void> {
  for (const n of [0, 1, 2, 3, 4, 5, 9, 33]) {
    const d = defer();
    const ws: Promise<number>[] = [];
    for (let i = 0; i < n; i++) ws.push(waiter("n" + n + "w" + i, d.p));
    await settleAfter(2);
    d.ok(n * 10);
    const all = await Promise.all(ws);
    log.push("n" + n + " all=" + all.join(","));
  }

  // a rejection wakes inline and vector waiters alike
  for (const n of [1, 2, 6]) {
    const d = defer();
    const ws: Promise<string>[] = [];
    for (let i = 0; i < n; i++) {
      ws.push(
        (async () => {
          try {
            await d.p;
            return "no";
          } catch (e) {
            return "r" + i + ":" + String(e);
          }
        })(),
      );
    }
    await settleAfter(1);
    d.no("boom" + n);
    log.push("rej " + (await Promise.all(ws)).join("|"));
  }

  // callbacks, awaiters, combinator entries registered in a known interleaving
  for (const first of ["await", "then", "all"]) {
    const d = defer();
    const order: string[] = [];
    const reg = (kind: string): Promise<unknown> => {
      if (kind === "await") return waiter("aw", d.p).then(() => order.push("await"));
      if (kind === "then") return d.p.then(() => order.push("then"));
      return Promise.all([d.p, Promise.resolve(1)]).then(() => order.push("all"));
    };
    const kinds = [first, "await", "then", "await", "all", "await"];
    const ps = kinds.map(reg);
    await settleAfter(1);
    d.ok(7);
    await Promise.all(ps);
    log.push(first + ": " + order.join(">"));
  }

  // an awaiter registered from inside a wake of the same promise's other awaiter
  const d2 = defer();
  const late: Promise<number>[] = [];
  const a = (async () => {
    const v = await d2.p;
    late.push(waiter("late", d2.p));
    return v;
  })();
  const b = waiter("b", d2.p);
  await settleAfter(1);
  d2.ok(5);
  await Promise.all([a, b, ...late]);
  log.push("late done " + late.length);

  // promises that are never awaited, settle with no waiter, and are awaited after settling
  const solo = defer();
  solo.ok(1);
  log.push("settled-first " + (await solo.p) + " " + (await solo.p));
  const never = defer();
  void never;
  console.log(log.join("\n"));
}

main();
