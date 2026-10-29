// process.stdout / process.stderr through a dynamic view answer Stream,
// Writable and EventEmitter whatever stdio kind they are (pipe, file, TTY).
// Readable and Duplex depend on the kind, so they are not asserted here.
import { Stream, Writable, Transform } from "stream";
import { EventEmitter } from "events";
const out: any = process.stdout;
const err: any = process.stderr;
console.log(String(out instanceof Stream), String(out instanceof Writable), String(out instanceof EventEmitter));
console.log(String(out instanceof Transform));
console.error(String(err instanceof Stream), String(err instanceof Writable), String(err instanceof EventEmitter));
