// The same intersection as a class method's and a getter's return type (mongodb's AbstractCursor.stream()), through a generic class.
import { Readable } from "node:stream";

class Cursor<T> {
  private items: T[];
  constructor(items: T[]) {
    this.items = items;
  }
  stream(): Readable & AsyncIterable<T> {
    return Readable.from(this.items);
  }
  get readable(): Readable & AsyncIterable<T> {
    return this.stream();
  }
}

async function main(): Promise<void> {
  const cur = new Cursor<string>(["x", "y"]);
  const seen: string[] = [];
  for await (const v of cur.stream()) seen.push(v);
  const r = cur.readable;
  r.on("data", (d) => seen.push("D" + String(d)));
  await new Promise<void>((res) => r.on("end", () => res()));
  console.log(seen.join(","));
}
main();
