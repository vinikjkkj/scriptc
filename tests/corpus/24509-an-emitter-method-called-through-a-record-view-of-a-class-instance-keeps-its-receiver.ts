// mysql2's pool 'connection' listener registers on the pooled connection through a structural view of it: `on` is the emitter's own
// method (outside the class table), and a call through the view has to reach the instance exactly as `conn.on(...)` does.
import { EventEmitter } from "node:events";
class Conn extends EventEmitter {
  threadId = 5;
  tag(x: string): string {
    return x + this.threadId;
  }
}
interface ConnView {
  threadId: number;
  tag(x: string): string;
  on(ev: string, cb: (e?: unknown) => void): unknown;
  once(ev: string, cb: (e?: unknown) => void): unknown;
  emit(ev: string, e?: unknown): boolean;
  listenerCount(ev: string): number;
}
const u: unknown = new Conn();
const cc = u as ConnView;
const seen: string[] = [];
console.log(cc.tag("a"));
cc.on("end", () => seen.push("end"));
cc.on("end", () => seen.push("end2"));
cc.once("error", (e?: unknown) => seen.push("error:" + String(e)));
cc.on("error", () => seen.push("e2"));
console.log(cc.listenerCount("end"), cc.listenerCount("error"));
(u as EventEmitter).emit("end");
console.log(cc.emit("error", "x"), cc.emit("error", "y"), seen.join(","));
