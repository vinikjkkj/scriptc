// Distilled from tests/harness/stackless-finally-body.test.ts when the fiber lane was removed: the program that file compared between the fiber lane and the
// stackless lane is now compared with Node on both backends (plain and sanitized) by the corpus.
async function p(n: number): Promise<number> {
  return n;
}

/* NORMAL completion only: the finally body's await runs on the fall-through
 * copy. */
async function wfbNormal(n: number): Promise<number> {
  let acc = 0;
  try {
    acc = acc + n;
  } finally {
    acc = acc + (await p(10));
  }
  return acc;
}

/* EXCEPTION path: the try body throws, so the finally body runs with an
 * exception pending and the await sits on the exception COPY. The stash
 * (ScrCaught) is taken before the body and re-raised after, across a park. */
async function wfbThrow(fail: boolean): Promise<number> {
  let acc = 0;
  try {
    if (fail) {
      throw new Error("boom");
    }
    acc = acc + 1;
  } catch (e) {
    acc = acc + 100;
  } finally {
    acc = acc + (await p(10));
  }
  return acc;
}

/* PENDING-RETURN path: the `return` inside the try is crossing the finally,
 * so its value is snapshotted BEFORE the finally runs and the body executes on
 * the pending-return copy -- with an await in it. The returned value must be
 * the snapshot (1), not what the finally computes. */
async function wfbReturn(n: number): Promise<number> {
  let acc = 0;
  try {
    return n;
  } finally {
    acc = acc + (await p(10));
  }
}

/* ALL THREE through one region, selected at runtime. */
async function wfbAll(mode: number): Promise<number> {
  let acc = 0;
  try {
    if (mode === 1) {
      throw new Error("x");
    }
    if (mode === 2) {
      return 7;
    }
    acc = acc + 1;
  } catch (e) {
    acc = acc + 100;
  } finally {
    acc = acc + (await p(10));
  }
  return acc;
}

async function main(): Promise<void> {
  console.log("fbnorm", await wfbNormal(5));
  console.log("fbthrow", await wfbThrow(false), await wfbThrow(true));
  console.log("fbret", await wfbReturn(1));
  console.log("fball", await wfbAll(0), await wfbAll(1), await wfbAll(2));
  console.log("done");
}
void main();
