// A second destroy(err) changes nothing (one 'error', one 'close'); destroy(undefined) destroys without an error.
import * as net from "node:net";
const first = new net.Socket();
first.on("error", (e: Error) => console.log("first error:", e.message));
first.on("close", () => console.log("first closed"));
first.destroy(new Error("one"));
first.destroy(new Error("two"));
const second = new net.Socket();
second.on("error", (e: Error) => console.log("second error:", e.message));
second.on("close", (hadError: boolean) => console.log("second closed, hadError:", hadError));
second.destroy(undefined);
console.log(first.destroyed, second.destroyed);
