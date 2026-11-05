import { EventEmitter } from "node:events";
type CursorEvents = { close(): void; data(d: unknown): void };
class TypedEE<Events extends Record<string, (...a: any[]) => void>> extends EventEmitter {}
class AbstractCursor<TSchema = any, Events extends Record<string, (...a: any[]) => void> = {}> extends TypedEE<Events> {
  protected docs: TSchema[] = [];
  protected closed = false;
  async next(): Promise<TSchema | null> { await null; return this.docs.length ? this.docs.shift()! : null; }
  async *[Symbol.asyncIterator](): AsyncGenerator<TSchema, void, void> {
    try {
      while (true) {
        const doc = await this.next();
        if (doc === null) break;
        yield doc;
      }
    } finally {
      console.log("cursor closed");
      this.closed = true;
    }
  }
}
class FindCursor<TSchema = any> extends AbstractCursor<TSchema, CursorEvents> {
  constructor(items: TSchema[]) { super(); this.docs = items; }
}
class TaggedCursor extends FindCursor<string> {
  async *[Symbol.asyncIterator](): AsyncGenerator<string, void, void> {
    while (true) { const d = await this.next(); if (d === null) return; yield "tag:" + d; }
  }
}
async function drain<T>(c: AbstractCursor<T, CursorEvents>): Promise<T[]> {
  const out: T[] = [];
  for await (const d of c) out.push(d);
  return out;
}
async function main() {
  console.log(await drain(new FindCursor([1, 2, 3])));
  console.log(await drain(new TaggedCursor(["a", "b"])));
  for await (const d of new FindCursor<number>([10, 20, 30])) { console.log(d); if (d === 20) break; }
  const any1: AbstractCursor<any, CursorEvents> = new FindCursor<any>([1, "x"]);
  for await (const d of any1) console.log(d);
}
main();
