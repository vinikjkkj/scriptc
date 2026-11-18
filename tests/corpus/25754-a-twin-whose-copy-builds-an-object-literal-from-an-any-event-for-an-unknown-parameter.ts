// An emitter listener whose body builds an object literal from the event and hands it to a function taking `unknown`: the erased twin sees `any` members there, which used to refuse the twin (SC2001) and leave the typed listener on the checked boundary (a TypeError for a payload outside the declared type, where Node carries on).
import { EventEmitter } from "node:events";
interface Ev { qr: string; ttlMs: number }
class Client extends EventEmitter {
  on(event: "auth_qr", l: (e: Ev) => void): this;
  on(event: string, l: (...a: any[]) => void): this { return super.on(event, l); }
}
const log: string[] = [];
function push(kind: string, data: unknown): void { log.push(kind + ":" + JSON.stringify(data)); }
const c = new Client();
const hold: { v: any } = { v: c };
c.on("auth_qr", (e) => {
  push("auth_qr", { qr: e.qr, ttlMs: e.ttlMs, both: [e.qr, e.ttlMs] });
  console.log(typeof e.qr, typeof e.ttlMs);
});
hold.v.emit.apply(hold.v, ["auth_qr", { qr: "Q", ttlMs: 7 }]);
hold.v.emit.apply(hold.v, ["auth_qr", { qr: 5, ttlMs: "soon" }]);
console.log(log.join("|"));
