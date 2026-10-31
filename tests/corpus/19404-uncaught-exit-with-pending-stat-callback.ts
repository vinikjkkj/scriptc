// @exit: 1
// fs.stat callbacks run on a later turn: a top-level throw before it fires
// makes Node exit 1 with the callback never run.
import * as fs from "node:fs";
fs.stat("./nonexistent-19404", (err) => console.log("stat", err !== null));
console.log("sync");
throw new Error("boom");
