// A Readable that also satisfies AsyncIterable<T> is the Readable: for await and 'data' both see its chunks, in either spelling of the intersection and with a type parameter.
import { Readable } from "node:stream";

function mkA(): Readable & AsyncIterable<string> {
  return Readable.from(["a", "b", "c"]);
}
function mkB(): AsyncIterable<string> & Readable {
  return Readable.from(["d", "e"]);
}
function gen<T>(items: T[]): Readable & AsyncIterable<T> {
  return Readable.from(items);
}

async function main(): Promise<void> {
  const out: string[] = [];
  for await (const c of mkA()) out.push(c);
  for await (const c of mkB()) out.push(c);
  const it = mkA()[Symbol.asyncIterator]();
  const first = await it.next();
  const second = await it.next();
  const third = await it.next();
  const last = await it.next();
  console.log(out.join(","), first.value, first.done, second.value, third.value, last.done);
  const g = gen(["p", "q"]);
  const strs: string[] = [];
  for await (const n of g) strs.push(n);
  console.log(strs.join("+"), g.destroyed, g.readable);
  const r2 = mkA();
  const got: string[] = [];
  r2.on("data", (c) => got.push(String(c)));
  await new Promise<void>((res) => r2.on("end", () => res()));
  console.log(got.join("|"), r2.destroyed);
}
main();
