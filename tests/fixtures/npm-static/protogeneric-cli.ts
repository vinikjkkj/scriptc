// npm-static pilot: `Class.prototype.<method>.call(recv, ...)` / `.apply(recv, [...])` over methods
// with untyped parameters (mysql2's promise facade over the base connection), and the read of such a
// method off the prototype answering a function, not undefined.
import protogeneric from "protogeneric";

console.log(protogeneric.run());
