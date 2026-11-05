// Async methods of JavaScript classes whose names a program rebinds at run time: `this[name] = fn` and `Class.prototype.m = fn`,
// with replacements that are async, plain, delayed and undefined-valued, a `super` call, a detached prototype function and a
// value read ordered against awaits.
import { scenario } from "twinrec/asyncslot";
void scenario((s) => console.log(s));
