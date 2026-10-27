// A computed options key naming objectMode: the stream delivers whole objects.
import { Readable } from "node:stream";

const key = "objectMode" as const;
const s = new Readable({ [key]: true, read() {} });
s.on("data", (v) => console.log("data", JSON.stringify(v)));
s.push("text-as-object");
s.push({ z: 26 });
s.push(null);
