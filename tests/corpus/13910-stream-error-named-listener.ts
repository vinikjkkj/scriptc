// A NAMED listener with a typed Error parameter, registered for 'error' on an
// objectMode stream. The payload is a non-Error value (a string, then an
// object): Node passes it through unchanged, so the typed parameter sees the
// raw value and its member reads answer undefined where the value lacks them.
import { Readable } from "node:stream";

function onErr(e: Error): void {
  console.log("named", typeof e, (e as any).message, (e as any).code);
}

const s = new Readable({ objectMode: true, read() {} });
s.on("error", onErr);
s.destroy("plain" as any);

const t = new Readable({ objectMode: true, read() {} });
t.on("error", onErr);
t.destroy({ code: "X" } as any);
