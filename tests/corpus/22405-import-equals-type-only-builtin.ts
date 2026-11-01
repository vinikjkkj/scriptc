import type EE = require("events");
import path = require("path");

function kind(e: EE | null): string {
  return e === null ? "none" : "emitter";
}
console.log(kind(null));
console.log(path.basename("q/w.md"));
