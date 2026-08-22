// `Readable.from(asyncGenerator)`: the error paths.
//
// A rejection mid-stream is the third thing a byte comparison cannot see.
// It has to reach the consumer AT the chunk it replaced — not at the end,
// and not as a stream that quietly ends short — so every section here
// prints the chunks that DID arrive beside the failure that stopped them.
//
// destroy(err) is the other half: Node's from() closes the source with
// `iterator.throw(error)`, so the generator's own catch/finally sees the
// error at its suspension point, and 'error'/'close' wait for that.
import { Readable } from "node:stream";

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

async function* failsAfterOne(): AsyncGenerator<Uint8Array, void, void> {
  yield new Uint8Array([1]);
  throw new Error("boom");
}

async function* failsInAnAwait(): AsyncGenerator<Uint8Array, void, void> {
  yield new Uint8Array([7]);
  await Promise.reject(new Error("rejected mid-stream"));
  yield new Uint8Array([8]);
}

async function* failsImmediately(): AsyncGenerator<Uint8Array, void, void> {
  throw new Error("nothing to give");
}

async function* catchesTheClose(): AsyncGenerator<Uint8Array, void, void> {
  try {
    yield new Uint8Array([100]);
    yield new Uint8Array([200]);
  } catch (e) {
    console.log("gen: caught " + (e instanceof Error ? e.message : "?"));
  } finally {
    console.log("gen: finally");
  }
}

async function drain(name: string, s: Readable): Promise<void> {
  console.log("--- " + name + " ---");
  await new Promise<void>((resolve) => {
    s.on("data", (chunk: Uint8Array) => {
      console.log("data " + String(chunk[0]));
    });
    s.on("error", (e: Error) => {
      console.log("error " + e.message);
    });
    s.on("close", () => {
      console.log("close");
      resolve();
    });
  });
}

async function destroyWithError(): Promise<void> {
  console.log("--- destroy(err) reaches the source ---");
  const s = Readable.from(catchesTheClose());
  await new Promise<void>((resolve) => {
    s.on("data", (chunk: Uint8Array) => {
      console.log("data " + String(chunk[0]));
      if (chunk[0] === 100) s.destroy(new Error("cancelled"));
    });
    s.on("error", (e: Error) => {
      console.log("error " + e.message);
    });
    s.on("close", () => {
      console.log("close");
      resolve();
    });
  });
}

async function main(): Promise<void> {
  await drain("throw after one chunk", Readable.from(failsAfterOne()));
  await drain("a rejected await mid-stream", Readable.from(failsInAnAwait()));
  await drain("throw before the first chunk", Readable.from(failsImmediately()));
  await destroyWithError();
  await sleep(20);
  console.log("done");
}

void main();
