// A bare builtin specifier is served by Node's builtin even when an npm package of the same
// name is installed (the builtin always wins). The installed `buffer` here answers WRONG.
import { Buffer } from "buffer";
const b = Buffer.from("abc");
console.log(b.toString("hex"), b.length);
