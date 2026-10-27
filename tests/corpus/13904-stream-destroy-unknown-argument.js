// destroy(x) where x is an untyped value (the JS lane's dyn argument):
// an Error emits 'error' then 'close'; undefined closes without 'error'.
import { Readable } from "node:stream";

function run(label, err) {
  const s = new Readable({ objectMode: true, read() {} });
  s.on("error", (e) => console.log(label, "error", e instanceof Error ? e.message : String(e)));
  s.on("close", () => console.log(label, "close"));
  s.destroy(err);
}
run("a", new Error("boom"));
run("b", undefined);
