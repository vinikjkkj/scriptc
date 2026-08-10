// A `Promise<void>` flowing into a `Promise<unknown>` slot. `Task<T> = () =>
// Promise<T>` instantiated at `T = unknown` and handed `() =>
// this.onDecodedFrame(f)` is the shape a bounded task queue is built out of:
// the queue awaits the task's result and throws it away, and the task has no
// result. tsc admits the assignment; the lowering used to have no exact
// conversion for the RESULT, so INVOKING the slot threw a stranded TypeError
// after the function had already run. In a queue that increments `running`
// before the call and decrements it in the settle handler, that throw
// escapes between the two and the queue never dequeues again — the first
// task runs and every later one is enqueued forever.
//
// The conversion is the one JS makes silently: a void result IS undefined,
// and undefined is a first-class dyn value. So the flow evaluates the
// operand for its EFFECTS and produces the undefined dyn — the same rule
// `unionWrap` has always used for a void payload landing in an
// undefined-armed union, one kind over. `Promise<void>` into
// `Promise<unknown>` is that rule inside the promise adapter: await the
// source (rejections rethrow, untouched), then fulfill with undefined.
//
// Everything below is behaviour Node and scriptc AGREE on.

type Task<T> = () => Promise<T>

async function frame(i: number): Promise<void> {
  console.log("frame", i);
}

interface Item {
  readonly task: Task<unknown>;
  readonly label: string;
}

// The drain loop this exists for: `running` goes up before the call and back
// down after the settle, so a throw between them wedges the queue.
class BoundedQueue {
  private readonly items: Item[] = [];
  private head = 0;
  private running = 0;
  private readonly maxConcurrency = 1;
  private readonly done: string[] = [];

  enqueue(label: string, task: Task<unknown>): void {
    this.items.push({ task, label });
  }

  async drain(): Promise<void> {
    while (this.running < this.maxConcurrency && this.head < this.items.length) {
      const item = this.items[this.head];
      this.head = this.head + 1;
      this.running = this.running + 1;
      // The call that used to throw: a `() => Promise<void>` invoked through
      // a `() => Promise<unknown>` slot.
      const settled = await item.task();
      this.done.push(item.label + ":" + String(settled === undefined));
      this.running = this.running - 1;
    }
  }

  report(): string {
    return this.done.join(",");
  }
}

async function boom(): Promise<void> {
  throw new Error("boom");
}

async function tick(): Promise<void> {
  console.log("tick");
}

async function takes(p: Promise<unknown>): Promise<boolean> {
  return (await p) === undefined;
}

async function forwards(): Promise<unknown> {
  // `return v()` in an async function declared Promise<unknown>: the return
  // flattens to `return await v()`, and the awaited void lands in the dyn
  // return slot.
  return tick();
}

const order: string[] = [];
function sideEffect(): void {
  order.push("ran");
}

class Handler {
  private count = 0;
  async handle(): Promise<void> {
    this.count = this.count + 1;
    console.log("8 handled", this.count);
  }
  seen(): number {
    return this.count;
  }
}

async function num(): Promise<number> {
  return 7;
}

let widened = 0;

async function main(): Promise<void> {
  // ── 1. the function-SLOT conversion, the shape zapo hits ───────────────
  const t: Task<unknown> = () => frame(0);
  const r0 = await t();
  console.log("1 result:", r0 === undefined, typeof r0);

  // ── 2. a bounded queue that drains past its first item ─────────────────
  const q = new BoundedQueue();
  for (let i = 1; i <= 4; i++) {
    q.enqueue("f" + String(i), () => frame(i));
  }
  await q.drain();
  console.log("2 drained:", q.report());

  // ── 3. rejection passes through the adapter untouched, every time ──────
  const rej: Task<unknown> = boom;
  try {
    await rej();
    console.log("3 NOT REACHED");
  } catch (e) {
    console.log("3 caught:", (e as Error).message);
  }
  try {
    await rej();
  } catch (e) {
    console.log("3 caught again:", (e as Error).message);
  }

  // ── 4. the promise VALUE flowing into the slot directly ────────────────
  const pv: Promise<unknown> = tick();
  console.log("4 awaited:", (await pv) === undefined);

  const ps: Promise<unknown>[] = [tick(), tick()];
  console.log("4 array:", ps.length);
  for (const p of ps) {
    console.log("4 elem:", (await p) === undefined);
  }
  console.log("4 param:", await takes(tick()));

  // ── 5. `return v()` from an async Promise<unknown> function ────────────
  console.log("5 forwarded:", (await forwards()) === undefined);

  // ── 6. a SYNC void result in an 'unknown' slot — the same rule with no
  // promise around it, and the ORDER matters: the operand runs, then the
  // undefined appears.
  const sf: () => unknown = sideEffect;
  const sv = sf();
  order.push("got:" + String(sv === undefined));
  console.log("6 order:", order.join(","));

  const u: unknown = sideEffect();
  console.log("6 direct:", u === undefined, order.length);

  const us: unknown[] = [sideEffect(), sideEffect()];
  console.log("6 array:", us.length, us[0] === undefined, us[1] === undefined, order.length);

  // ── 7. parameters ride along, and the source may take fewer of them ────
  const withArgs: (a: number, b: string) => Promise<unknown> = async (
    a: number,
    b: string,
  ): Promise<void> => {
    console.log("7 args:", a, b);
  };
  console.log("7 result:", (await withArgs(9, "x")) === undefined);

  const fewer: (a: number) => unknown = (): void => {
    console.log("7 fewer");
  };
  console.log("7 fewer result:", fewer(1) === undefined);

  // ── 8. a class METHOD through the slot, and the one interned adapter
  // reused across several call sites.
  const h = new Handler();
  const m: Task<unknown> = () => h.handle();
  await m();
  await m();
  const m2: Task<unknown> = () => h.handle();
  await m2();
  console.log("8 count:", h.seen());

  // ── 9. a NON-void payload still travels: the widening did not turn every
  // `Promise<unknown>` slot into an undefined.
  const asUnknown: () => Promise<unknown> = num;
  console.log("9 unknown slot:", await asUnknown());

  // ── 10. many adapted calls in a loop — the interned helper and the fresh
  // promise it hands back must not accumulate.
  const loopTask: Task<unknown> = async (): Promise<void> => {
    widened = widened + 1;
  };
  for (let i = 0; i < 50; i++) {
    const got = await loopTask();
    if (got !== undefined) {
      console.log("10 UNEXPECTED");
    }
  }
  console.log("10 loop:", widened);
}

main();
