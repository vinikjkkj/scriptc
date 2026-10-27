// A listener bound by a CONST to an arrow function, with a typed Error
// parameter, registered for 'error' on an objectMode stream. The payload is a
// non-Error value: Node passes it through, so the parameter's member reads
// answer undefined where the value lacks them.
import { Readable } from "node:stream";

const onErr = (e: Error): void => {
  console.log("const", typeof e, (e as any).message, (e as any).code);
};

const s = new Readable({ objectMode: true, read() {} });
s.on("error", onErr);
s.destroy("plain" as any);

const t = new Readable({ objectMode: true, read() {} });
t.on("error", onErr);
t.destroy({ code: "X" } as any);
