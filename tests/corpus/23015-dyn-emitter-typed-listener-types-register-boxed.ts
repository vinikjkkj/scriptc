import { EventEmitter } from "events";
class Item { id: number; constructor(id: number) { this.id = id; } }
const bus = new EventEmitter();
function leak(x: unknown): string { return typeof x; }
console.log(leak(bus)); // boxes the emitter: the module now registers boxed typed listeners
bus.on("rec", (r: { a: number; b: string[] }) => console.log("rec", r.a, r.b.join("+")));
bus.on("arr", (xs: number[]) => console.log("arr", xs.length));
bus.on("item", (i: Item) => console.log("item", i.id));
bus.on("map", (m: Map<string, number>) => console.log("map", m.size));
bus.once("big", (n: bigint) => console.log("big", n));
bus.on("buf", (b: Buffer) => console.log("buf", b.length));
bus.prependListener("rec", () => console.log("first"));
bus.emit("rec", { a: 1, b: ["x", "y"] });
bus.emit("arr", [1, 2, 3]);
bus.emit("item", new Item(7));
bus.emit("map", new Map([["k", 1]]));
bus.emit("big", 5n);
bus.emit("buf", Buffer.from("abcd"));
console.log(bus.listenerCount("rec"), bus.eventNames().join(","));
// typed listeners that capture the emitter they are registered on (a ring the registry owns)
function ring(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const e = new EventEmitter();
    leak(e);
    e.on("tick", (k: number) => { total += k + e.listenerCount("tick"); });
    e.once("done", () => { e.emit("tick", 1); });
    e.emit("tick", i);
    e.emit("done");
  }
  return total;
}
console.log(ring(5));
