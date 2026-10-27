// An instance `_read` hook assigned on an objectMode Readable (mysql2's
// createBinlogStream shape). Node calls the hook when the consumer pulls and
// ignores its return value; the object the hook returns is never delivered.
import { Readable } from "node:stream";

let test = 1;
const stream = new Readable({ objectMode: true });
stream._read = function () {
  return { data: test++ };
};
stream.on("data", (v) => console.log("data", v));
stream.push("a");
stream.push(null);
console.log("test", test);
