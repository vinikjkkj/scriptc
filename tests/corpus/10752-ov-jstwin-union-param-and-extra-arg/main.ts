// A JS-twin subclass whose send takes a third untyped parameter, and whose
// stream parameter is typed in the base as a union of an interface and a
// class. Calls through the base type reach the override; the absent third
// argument is undefined.
import Sub, { Base, Sock } from "./lib.js";

Sub.tag = Sub.tag + "!";
const p = { isPipeline: true as const, write(d: string) { return d; } };
const b: Base = new Sub();
console.log(Sub.tag, b.send("x"), b.send("y", p), new Sub().send("z", new Sock()));
