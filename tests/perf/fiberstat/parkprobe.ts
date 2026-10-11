/* parkprobe -- THE POSITIVE CONTROL for the per-entry park table.
 *
 * A gauge that can only read zero passes every workload, and the number this
 * slice has to defend is a ZERO on the zapo-rest bench. So before that zero
 * means anything the counter has to be shown reading a NUMBER I CHOSE, for
 * the shape I care about.
 *
 * TWO shapes run here, and the difference between them IS the finding:
 *
 *   PlainReader.ensure   awaits a method that returns a Promise. Same loop,
 *                        same body, no async iterator. This one CONVERTS --
 *                        the artifact carries no scr_async_spawn for it at
 *                        all, so it can never park and never appear here.
 *
 *   AgenReader.ensure    awaits `this.iterator.next()` where `iterator` is
 *                        an AsyncIterator, which is byte-for-byte the shape
 *                        of ProtoStreamReader.ensure (zapo-js 1.8.2,
 *                        src/util/proto-stream.ts:93-105). This one is
 *                        REFUSED and stays on a fiber, so its parks land in
 *                        the table.
 *
 * Each shape holds exactly PARKED_TARGET frames parked at the same instant
 * and then releases them. The table must show, for one `async` entry,
 * parkHi == PARKED_TARGET. Any other value -- 0, 1, or 2*N -- means the
 * instrument cannot be read and the bench zero it is meant to license means
 * nothing.
 */

const PARKED_TARGET = 7;

interface Chunk {
  done: boolean;
  value: Uint8Array;
}

/* A gate whose promise stays UNSETTLED until release(): a consumer sitting
 * in `await` on it is parked on an unsettled promise, which is the
 * suspension scr_await_park counts and the one a microtask hop is not. */
class Gate {
  private held: Promise<boolean>;
  private releaseFn: ((v: boolean) => void) | null = null;

  public constructor() {
    this.held = new Promise<boolean>((res) => {
      this.releaseFn = res;
    });
  }

  public release(): void {
    const fn = this.releaseFn;
    if (fn !== null) {
      this.releaseFn = null;
      fn(true);
    }
  }

  public wait(): Promise<boolean> {
    return this.held;
  }
}

/* ── shape 1: a plain promise-returning source ───────────────────────── */

interface ChunkSource {
  next(): Promise<Chunk>;
}

class GatedSource implements ChunkSource {
  private served = 0;
  private readonly gate: Gate;

  public constructor(gate: Gate) {
    this.gate = gate;
  }

  public async next(): Promise<Chunk> {
    if (this.served > 0) {
      return { done: true, value: new Uint8Array(0) };
    }
    await this.gate.wait();
    this.served += 1;
    return { done: false, value: new Uint8Array(4) };
  }
}

class PlainReader {
  private readonly iterator: ChunkSource;
  private buffered = 0;

  public constructor(source: ChunkSource) {
    this.iterator = source;
  }

  public async ensure(byteLength: number): Promise<boolean> {
    while (this.buffered < byteLength) {
      const next = await this.iterator.next();
      if (next.done === true) {
        return false;
      }
      const chunk = next.value;
      if (chunk.byteLength === 0) {
        continue;
      }
      this.buffered += chunk.byteLength;
    }
    return true;
  }
}

/* ── shape 2: the real one -- an ASYNC ITERATOR ──────────────────────── */

async function* gatedChunks(gate: Gate): AsyncGenerator<Uint8Array> {
  await gate.wait();
  yield new Uint8Array(4);
}

class AgenReader {
  private readonly iterator: AsyncGenerator<Uint8Array>;
  private buffered = 0;

  public constructor(source: AsyncGenerator<Uint8Array>) {
    this.iterator = source;
  }

  /* the shape of ProtoStreamReader.ensure */
  public async ensure(byteLength: number): Promise<boolean> {
    while (this.buffered < byteLength) {
      const next = await this.iterator.next();
      if (next.done === true) {
        return false;
      }
      const chunk = next.value;
      if (chunk.byteLength === 0) {
        continue;
      }
      this.buffered += chunk.byteLength;
    }
    return true;
  }
}

async function settle(ms: number): Promise<boolean> {
  return await new Promise<boolean>((res) => {
    setTimeout(() => res(true), ms);
  });
}

async function main(): Promise<void> {
  /* --- shape 1 ------------------------------------------------------- */
  const g1: Gate[] = [];
  const p1: Promise<boolean>[] = [];
  for (let i = 0; i < PARKED_TARGET; i += 1) {
    const g = new Gate();
    g1[g1.length] = g;
    p1[p1.length] = new PlainReader(new GatedSource(g)).ensure(4);
  }
  await settle(200);
  console.log(`plain parked-target ${PARKED_TARGET}`);
  for (let i = 0; i < g1.length; i += 1) {
    g1[i].release();
  }
  let ok1 = 0;
  for (let i = 0; i < p1.length; i += 1) {
    if (await p1[i]) ok1 += 1;
  }
  console.log(`plain ensured ${ok1}`);

  /* --- shape 2 ------------------------------------------------------- */
  const g2: Gate[] = [];
  const p2: Promise<boolean>[] = [];
  for (let i = 0; i < PARKED_TARGET; i += 1) {
    const g = new Gate();
    g2[g2.length] = g;
    p2[p2.length] = new AgenReader(gatedChunks(g)).ensure(4);
  }
  await settle(200);
  console.log(`agen parked-target ${PARKED_TARGET}`);
  for (let i = 0; i < g2.length; i += 1) {
    g2[i].release();
  }
  let ok2 = 0;
  for (let i = 0; i < p2.length; i += 1) {
    if (await p2[i]) ok2 += 1;
  }
  console.log(`agen ensured ${ok2}`);

  /* process.exit lowers to _Exit and skips atexit; the interposer in
   * scr_fiber_stat.h is what writes the report on this path, and that is
   * exactly the path zapo-rest's /shutdown route takes. */
  process.exit(0);
}

void main();
