// Two async loops side by side: one over an async generator, one over a
// stream. In Node they cost the SAME per chunk, so they alternate. When the
// stream loop settled a turn early it ran ahead and finished first — an
// ordering a person reads straight off the console, with no ruler and no
// instrumentation, out of a program that does nothing unusual.
//
// The shapes here are the ones that move the count around: a body that
// awaits (both loops pay one more turn, so they must still alternate), a
// `Promise.resolve().then` racing the body, and each of the three ways out
// of the loop — break, return, throw — with a racer to place them against.
import { Readable } from "node:stream";

async function* three(tag: string): AsyncGenerator<string> {
  yield tag + "1";
  yield tag + "2";
  yield tag + "3";
}

async function genLoop(): Promise<void> {
  for await (const c of three("g")) console.log("G " + c);
  console.log("G end");
}

async function streamLoop(): Promise<void> {
  for await (const c of Readable.from(["s1", "s2", "s3"])) console.log("S " + String(c));
  console.log("S end");
}

async function genLoopAwaiting(): Promise<void> {
  for await (const c of three("g")) {
    await Promise.resolve();
    console.log("g " + c);
  }
  console.log("g end");
}

async function streamLoopAwaiting(): Promise<void> {
  for await (const c of Readable.from(["s1", "s2", "s3"])) {
    await Promise.resolve();
    console.log("s " + String(c));
  }
  console.log("s end");
}

async function breakOut(): Promise<void> {
  void Promise.resolve().then(() => {
    console.log("  racer break");
  });
  for await (const c of Readable.from(["b1", "b2", "b3"])) {
    console.log("B " + String(c));
    break;
  }
  console.log("B after");
}

async function returnOut(): Promise<string> {
  void Promise.resolve().then(() => {
    console.log("  racer return");
  });
  for await (const c of Readable.from(["r1", "r2"])) {
    return "R " + String(c);
  }
  return "R none";
}

async function throwOut(): Promise<void> {
  void Promise.resolve().then(() => {
    console.log("  racer throw");
  });
  try {
    for await (const c of Readable.from(["t1", "t2"])) {
      throw new Error("T " + String(c));
    }
  } catch (e) {
    console.log(e instanceof Error ? e.message : "?");
  }
  console.log("T after");
}

async function main(): Promise<void> {
  const a = genLoop();
  const b = streamLoop();
  await a;
  await b;

  const c = genLoopAwaiting();
  const d = streamLoopAwaiting();
  await c;
  await d;

  await breakOut();
  console.log(await returnOut());
  await throwOut();
  console.log("done");
}

void main();
